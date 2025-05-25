Thanks! I’ll look into how to build a simple Git HTTP "dumb" protocol server that supports both push and pull operations, using Cloudflare Durable Objects and a custom SQLite-based backend. I’ll also ensure the server is compatible with isomorphic-git as the client, and does not require authentication.

I’ll get back to you with details on protocol requirements, design considerations, and reusable components or examples where possible.


# Building a Git Server on Cloudflare DO with Dumb HTTP and SQLite

## Overview

We want a lightweight Git server running in a Cloudflare Durable Object (DO) that uses the **“dumb” HTTP protocol** for Git. This means the server will serve Git data as simple static HTTP resources (no Git-aware CGI processes), making it compatible with clients (like *isomorphic-git*) that can fall back to the dumb protocol. Our server will store repository data (Git objects and refs) in a **SQLite database** within the DO for persistence. It should support **pull (clone/fetch)** and **push** operations (no authentication needed). Below we outline the necessary Git HTTP endpoints to implement, how to map them to DO HTTP handlers, how to serve data from SQLite, and how to handle receiving pushed data. We’ll also note patterns from similar implementations and ensure isomorphic-git compatibility.

## Git “Dumb” HTTP Protocol Essentials

In the dumb HTTP protocol, a Git repository is exposed via a set of files/URLs that a client can fetch. There is no interactive negotiation as in the smart protocol – the client simply downloads the necessary files. Key components we need to support:

* **Repository Info Files**:

  * **`HEAD`** – indicates the default branch. It’s a text file typically containing a reference like `ref: refs/heads/main`. Dumb clients may fetch `$GIT_URL/HEAD` to discover the default branch name. (This file is *not* listed in the refs listing, see below.)
  * **`info/refs`** – lists all branch and tag references and their latest commit hashes. The dumb client starts by requesting `$GIT_URL/info/refs`. The server should respond with a text file (content-type e.g. `text/plain`) listing each ref name and its object ID, one per line, e.g.:

    ```
    d049f6c27a2244e12041955e262a404c7faba355	refs/heads/master  
    2cb58b79488a98d2721cea644875a8dd0026b115	refs/tags/v1.0  
    a3c2e2402b99163d1d59756e5f207ae21cccba4c	refs/tags/v1.0^{}  
    ```

    Each line has the object SHA-1 and ref name separated by a tab. **Annotated tags** appear twice: the tag ref itself and a “peeled” entry with the `^{} suffix pointing to the tag’s target commit** (as shown for `v1.0`above):contentReference[oaicite:2]{index=2}. The list should be sorted by ref name and **must NOT include the`HEAD`ref**:contentReference[oaicite:3]{index=3} (since HEAD is given by the separate file). The server should mark this response as non-cacheable (e.g. add`Cache-Control: no-cache`) so clients always get fresh data. Importantly, do **not** use a Git-specific MIME type for dumb responses – for example, use `text/plain`and ensure it **does not** start with`application/x-git-\` (otherwise the client will think it’s smart-protocol). Clients will ignore the content-type if it’s not the special Git type, and interpret any 200 OK as a valid text list of refs.

* **Loose Objects**:

  * **`objects/<xx>/<yyyy...>`** – paths to individual Git objects by hash. In a Git repository, loose objects are stored under the `objects` directory using a two-level scheme: the first 2 hex digits of the SHA-1 as a directory, and the remaining 38 hex as the filename. For example, an object with hash `d049f6...` would be served at `$GIT_URL/objects/d0/49f6c27a2244e12041955e262a404c7faba355`. A dumb client will request each needed object via HTTP GET on these URLs. Our server must be able to retrieve the raw object data from SQLite and return it verbatim. Git objects are stored in a zlib-compressed format (with an internal header), and the server should serve that raw binary. (No special content-type needed – `application/octet-stream` or no content-type is fine, as Git clients don’t check it for dumb GETs.) If an object is not found (e.g. client requests an object that only exists in packfiles), the server should return 404, prompting the client to try another route (see pack files below).

* **Pack Files (for efficiency)**:

  * **`objects/info/packs`** – an index of packfiles on the server. To optimize dumb fetches, servers usually pre-pack objects and list them here. This file lists each available pack by name (prefixed by “P ”). For example:

    ```
    P pack-<packhash>.pack  
    ```

    The presence of `objects/info/packs` tells the client it can fetch whole packfiles instead of many individual objects. If the client gets 404s for loose objects, it will check `$GIT_URL/objects/info/packs` and then attempt to download the pack files listed. So, to support efficient cloning, our server can generate this file from the SQLite DB if packfiles are stored (or generate packs on the fly after certain pushes). Maintaining `objects/info/packs` is traditionally done by the `git update-server-info` command – whenever packs are added/removed, this file should be updated. In our design, we can dynamically produce it by querying which pack blobs exist in the DB. Initially, you might keep it simple and serve only loose objects (no packs), but for larger repos, supporting packfiles is beneficial. If implementing pack support, you also need to serve:

    * **`objects/pack/pack-<hash>.pack`** – the packfile binary data.
    * **`objects/pack/pack-<hash>.idx`** – index for the pack (though the client might not strictly require the .idx for dumb clone, it can generate its own index after downloading the .pack).
      Ensure any new pack added (e.g. via a push) is recorded in the `info/packs` listing so clients know to fetch it.

**Summary:** A minimal dumb HTTP server must handle **`HEAD`**, **`info/refs`**, **`objects/<dir>/<file>`**, and optionally **`objects/info/packs`** (plus pack files) for read operations. These correspond to static files in a bare Git repo. In fact, a common setup for dumb HTTP is simply hosting a bare repo on a static file server, with `git update-server-info` run after pushes. For example, enabling dumb HTTP on a bare repo might involve enabling a `post-update` hook that runs `git update-server-info`. A Stack Overflow example demonstrates preparing a repo for dumb HTTP and serving it with Python’s http.server. Once the server is up, a client’s initial requests look like this:

```plaintext
GET /info/refs?service=git-upload-pack HTTP/1.1   # client tries smart first
GET /HEAD HTTP/1.1                                # fetch HEAD file (default branch)
GET /objects/26/2c45... HTTP/1.1                  # try loose object (if 404, will try pack)
... 
```

The first request is the client checking if smart protocol is available. A dumb server will ignore the `?service=git-upload-pack` param and just return the plain refs listing (with a 200 OK and text/plain). Seeing a plain response (not the smart advertisement), the Git client (or isomorphic-git) falls back to dumb mode. It then fetches `HEAD` to find the default branch, and proceeds to get needed objects. If some `objects/..` requests return 404 (because the object is packed), the client will request `objects/info/packs` and then download the pack file. This behavior ensures compatibility with both loose and packed storage.

## Mapping HTTP Endpoints in a Durable Object

Cloudflare Durable Objects allow us to implement these endpoints in JavaScript (or WASM) with a persistent state. We can designate one DO instance per repository. The DO’s `fetch(request)` handler can parse the URL and route it to the appropriate logic. For example, if our repository is identified by some name or ID in the path (say the path format is `/repo/<name>/<rest>` or we have a subdomain per repo), the DO will receive requests for that repo and we then inspect the `<rest>` path:

* **`GET /HEAD`** – Return the content of the HEAD reference (e.g. `"ref: refs/heads/main\n"`). This can be looked up from the SQLite DB (perhaps stored as a special entry or derived from a default branch setting in the refs table). Make sure to include the trailing newline. If HEAD is detached (rare in a bare repo), it might be a raw SHA-1 instead of `ref: ...`. Typically though, HEAD is a symbolic ref to a branch. Content-type can be `text/plain`.

* **`GET /info/refs`** – Return the refs listing as described. Here we query the database for all refs in `refs/heads/*` and `refs/tags/*`. Construct a response by sorting refs by name and outputting `<hash>\t<refname>\n` for each. **Do not include HEAD** in this list. For each annotated tag (where the stored ref points to a tag object), you’ll need to also output a peeled line with the commit object ID (resolve the tag object’s target). For example, if `refs/tags/v1.0` points to an object of type *tag*, and that tag’s object field is a commit `a3c2e240...`, then include a line `a3c2e240...	refs/tags/v1.0^{}:contentReference[oaicite:19]{index=19}`. These peeled lines let clients know the tag’s pointee. In SQLite, you might have to fetch the tag object blob and parse it (or store an “peeled” value separately) to get that commit ID. The DO can compute this on the fly since overhead is small.

  * For compatibility, if the request arrives with a query `?service=git-upload-pack` (which a smart-aware client like Git will append), your handler can simply ignore the query and still return the same plaintext refs list (dumb server behavior). This signals clients to use dumb mode. (Alternatively, one could implement the smart upload-pack service, but since we target dumb for reads, ignoring it is fine.)
  * Set appropriate headers: e.g. `Cache-Control: no-cache` to avoid caching, and a simple `Content-Type: text/plain; charset=utf-8`. (The Git spec says clients won’t validate the MIME type as long as it isn’t the special smart type, but `text/plain` is a good choice.)

* **`GET /objects/<prefix>/<suffix>`** – Extract the `<prefix>` (2 hex chars) and `<suffix>` (38 hex) from the URL to form the 40-char object ID. Look up this object in the SQLite database and, if found, stream back the raw object bytes. These bytes should be exactly the content as stored in a Git object file (which is zlib-compressed data containing the header like "`blob 123\0...` etc. and the content). If the object isn’t found, return 404. (The client will then possibly try the pack file route.)

  * Implementation detail: You might choose to store objects in SQLite either compressed or uncompressed. One simple approach is to store them exactly as they would be on disk (zlib-compressed). That way, you don’t even have to recompress on the fly – just retrieve the blob and write it to the response as-is. This is memory-efficient and ensures fidelity to Git’s expected format. On the other hand, storing uncompressed object data (with type info separately) is also possible, but then your server code would need to reconstruct the Git object format and compress it for every GET. Using the compressed blobs directly (as produced by Git or by your push mechanism) is straightforward.
  * No special content type is needed for object responses. In fact, static dumb servers often just serve them with default or binary MIME types. The Git client doesn’t check – it just reads the raw bytes.

* **`GET /objects/info/packs`** – If you decide to support packfiles, implement this to list packs. On each request, you could query a `packs` table in SQLite or a manifest of packs stored. The format is one line per pack file, e.g. `P pack-<hash>.pack`. If no pack files exist (all objects are loose), this file could either be absent (404) or present but empty. Git clients will only query this after loose object requests fail, so it’s okay to 404 if you truly have no packs (client will then assume all objects should be fetched individually). If packs exist, ensure this file is accurate – update it whenever new pack is created or removed. In practice, after a push that adds many objects, you might run a packing routine and then update this listing (similar to `git update-server-info`). In a dynamic server, we can just compute it fresh or store a cached copy in DO state.

* **`GET /objects/pack/pack-<hash>.pack`** (and possibly `.idx`) – Serve the actual pack file bytes. These would be stored in SQLite likely as a BLOB (since pack files can be large, ensure your DO and DB can stream it). The client will fetch the .pack URL if it sees it listed. The .idx may or may not be fetched by the dumb client; typically `git clone` dumb doesn’t explicitly fetch .idx (it can build one itself after getting the pack), but to be safe, providing it (or at least not erroring) might be good.

All these endpoints can be handled within the DO’s JavaScript. You might structure your code with a router: e.g., if path starts with `/objects/` then route to object fetch handler, if `/info/refs` then route to refs handler, etc. Durable Objects allow reading/writing a per-object KV storage (which we can use to persist small data), but since we want a **SQLite backend**, you have a couple options:

* Use Cloudflare’s **D1** (Beta) which is a managed SQLite database you can bind to a Worker/DO. You would execute SQL queries in the DO to get or store data. This offloads actual storage to Cloudflare’s database service.
* Or, run SQLite *within* the DO using a WASM SQLite or custom-built solution. This is more involved (you’d compile SQLite to WASM or use something like absurd-sql). Cloudflare has examples of persisting SQLite databases in DOs by storing the file bytes in DO storage between sessions. Projects like **StarbaseDB** demonstrate an HTTP SQLite server on DOs. However, since Git objects can be large and numerous, using D1 or an internal KV might be easier than trying to store a whole .git directory structure.

Given SQLite, let’s propose a simple schema:

* **`objects` table**: columns like `(id TEXT PRIMARY KEY, type TEXT, data BLOB)`. Here `id` is the 40-hex SHA1 (or could be BLOB 20 bytes), `type` is “blob”, “tree”, “commit”, or “tag” (optional, we might not need to store type explicitly if we always store full object data including the header; but storing type can be handy for quick logic like knowing if an object is a tag to peel it), and `data` is the raw object content (probably compressed bytes as mentioned).
* **`refs` table**: `(name TEXT PRIMARY KEY, value TEXT)`. Store refs like `refs/heads/master` -> `<sha1>`. For annotated tags, `refs/tags/<name>` -> `<sha1 of tag object>` (the tag object will exist in `objects`). We also handle symbolic refs: we can either store `HEAD` as a special case (for example, a row where `name = 'HEAD'` and `value = 'refs/heads/main'`). Since HEAD in a bare repo is typically a symbolic ref, we can store the ref it points to. Alternatively, we could treat HEAD not as a normal ref row but store it in DO storage as a config. But including it in the `refs` table as name "HEAD" is fine as long as our code knows to handle it appropriately (in `info/refs` we won’t include it). If HEAD were ever detached (not likely on server side), we could either store the raw SHA in `value` or still use the same field since a detached HEAD is just a SHA (not starting with "ref:").
* Optionally, a **`packs` table** if you want to store pack files (e.g., `(filename TEXT PRIMARY KEY, data BLOB)`). But storing large pack blobs in SQLite might be heavy. Another approach: you could store pack files as objects as well (just treat them differently) or simply generate packs on the fly from objects. Given our simplicity goal, we might not initially implement pack storage; instead rely on loose objects. This is acceptable for small repos and testing (just know it will be slower for big repos).

## Serving Git Data from SQLite

With the schema above, implementing the read endpoints is straightforward:

* **HEAD**: Query `SELECT value FROM refs WHERE name='HEAD'`. Suppose it returns `"refs/heads/main"`. We respond with `ref: refs/heads/main\n`. (Our DB might store the "ref: ..." prefix as part of the value or not; to keep it consistent, you might store just `refs/heads/main` and prepend "ref: " when serving, because in some contexts (smart protocol symref advertisement) you might need the target separately.)
* **info/refs**: Query `SELECT name, value FROM refs WHERE name != 'HEAD'`. From results, filter into two categories: tag refs vs others. For each ref:

  * If it’s a tag (`refs/tags/...`):

    * Get the `value` (which is the object ID of the tag *object* for annotated tags, or of a commit for lightweight tags). Either way, include a line with that ID and the ref name.
    * If the object type of that ID is a tag object (you can find out by either storing type or by fetching the object from `objects` and examining the first bytes of decompressed data which will say "tag"), then you should also output the peeled line. To get the peeled target: for a tag object, you need to read its content (the tag object format has a line `object <targetSHA>` in it). You could parse the tag object by reading `data` from the `objects` table for that SHA and extracting the `object ...` line. (Alternatively, you might store a separate table of peeled pointers, but that’s overkill; parsing on the fly is fine given the relatively small number of tags.)
    * Output the peeled line with the commit (or blob) SHA and ref name suffixed with `^{} `.
  * If it’s a branch (`refs/heads/...` or other refs like `refs/remotes/...` if you have any, though probably just heads and tags in a bare repo):

    * Just output the value SHA and ref name.
  * Sort all lines by ref name (ensuring tags and their peeled lines are appropriately ordered – typically the peeled `^{} ` line comes immediately after its tag line because `^` comes after the base name in sort order). Sorting by name in C locale will do that naturally.
  * The result is the info/refs content. As noted, do not include HEAD in this list (since HEAD is not a permanent ref and is provided separately).
* **objects**: Query `SELECT data FROM objects WHERE id='<sha>'`. If found, stream the bytes out. If not, 404. If the data is stored compressed, you can send it directly. If it’s stored uncompressed, you’d compress it and prepend the Git header. (Storing compressed is easier to serve.)
* **objects/info/packs**: Query `SELECT filename FROM packs`. For each row, output `P <filename>` (where `<filename>` is e.g. `pack-xxxxxxxx.pack`). Ensure the “P ” is there as shown in Git’s format. If no packs, you could either return 404 or an empty file. (Git’s http-fetcher code will try to GET this file and treat 404 as “no packs available” and proceed to try loose objects. If you return an empty 200 OK file, the client might interpret it as “no packs” as well. Either approach is fine; traditionally if `info/packs` exists but is empty, it’s effectively the same as no packs.)

One important note: **Consistency**. Since our DO is stateful, when a push updates the database, we must ensure subsequent reads reflect those changes. Durable Objects are single-threaded per ID, so we don’t have to worry about concurrent requests interleaving incorrectly – the DO will serialize them. But if multiple clients are fetching and pushing concurrently, you should consider ordering. Typically, after processing a push (which alters refs and adds objects), you’d want to update some in-memory cache or state so that any immediately following `info/refs` request sees the new refs. If using a single SQLite, the data is the source of truth, so as long as you commit the transaction before responding to the push, any later reads will see the committed state. Using transactions around the push can ensure atomic ref update + object insert.

## Handling Push (Receiving Data)

The “dumb” protocol historically was **read-only** – to push over HTTP, Git clients require the “smart” HTTP protocol (`git-receive-pack` service). In our server, to support pushes from isomorphic-git or Git CLI, we’ll implement the minimal smart HTTP endpoints for **receives**. This does **not** mean we need the full Git server implementation; we just have to handle the standard push request format:

* **Advertisement of receive-pack:** When a client is about to push, it will usually do a `GET $GIT_URL/info/refs?service=git-receive-pack`. In smart protocol, this returns a special packet-format listing of refs along with server capabilities. We should support this endpoint so the push client knows what it can do. Concretely:

  * The server should respond with `Content-Type: application/x-git-receive-pack-advertisement` and no caching.
  * The body is in pkt-line format (the Git packet protocol). The first line is `# service=git-receive-pack` (preceded by its length in a 4-hex-digit header), then a flush packet (`0000`). After that, each ref is output as a pkt-line of the form: `<sha> <refname>\0<capabilities>` for the first ref (null-byte separates ref from capability string), and subsequent refs as `<sha> <refname>` without capabilities. According to Git’s specs, the **HEAD ref should be listed first** in the advertisement (as a symref if HEAD points to a branch). In practice, Git includes a capability like `symref=HEAD:refs/heads/main` in the first ref’s capabilities to tell the client about the default branch. We can do something similar: e.g., if our HEAD points to refs/heads/master, we include `symref=HEAD:refs/heads/master` in the capabilities string of the first line.
  * Capabilities: For push, at minimum we want `report-status` (so the client expects a detailed result report) and probably `delete-refs` (to allow deletion of branches), and maybe `ofs-delta` (if we want to accept packs with delta offsets – isomorphic-git by default might generate pack with only ref-deltas, but advertising ofs-delta is fine). We can also send `agent=<name>` to identify our server. For simplicity: advertise `report-status`, `delete-refs`, and `ofs-delta` (and `side-band-64k` if we plan to send progress messages, though for receive-pack, side-band is less crucial except for streaming stderr). Isomorphic-git’s push implementation will honor `report-status` – it expects the server to send an “unpack ok” or error line if that is advertised. So definitely include `report-status`.
  * Example first advertisement line (pkt-line):

    ```
    <40-byte HEAD commit> HEAD\0 report-status delete-refs symref=HEAD:refs/heads/main
    ```

    (plus possibly other caps). Followed by each branch and tag ref as separate pkt-lines (without caps). Each pkt-line is length-prefixed. This is a bit involved to implement from scratch, but since we know all refs from the DB, we can construct it.
  * If implementing this seems too much, there is a shortcut: Some clients (like the pygit example below) might skip the refs discovery for push and directly post to `/git-receive-pack` using known info. But to be robust for general Git clients, implementing the advertise step is recommended.

* **Receiving the Pack (POST to `/git-receive-pack`):** This is the core of push. The client will send an HTTP POST to `$GIT_URL/git-receive-pack` with content type `application/x-git-receive-pack-request` (Git CLI does this; isomorphic-git likely does too via its http client). The body of the request is a packfile preceded by “pack push negotiation” pkt-lines. Specifically, the POST data layout is:

  1. One or more pkt-lines containing ref update commands of the form:
     `<old-obj-id> <new-obj-id> <ref-name>\0 <capabilities>\n` for the first line (caps only on first line after the ref name, following a NUL), and `<old> <new> <ref>\n` for subsequent lines (if multiple branches are updated in one push). If a branch is being created, `<old>` is all zeros (`0000...0000` 40 chars); if deleted, `<new>` is all zeros.
  2. A flush packet (`0000`) marking the end of the ref commands.
  3. Then the packfile data, starting with the 4-byte signature "PACK". The packfile contains all the new objects that the server will need to fulfill the reference updates.

  Our server’s job is to **parse and apply this**:

  * Read the initial pkt-lines to get the list of ref updates requested. For example, the client might send:
    `oldSha newSha refs/heads/master\u0000 report-status ...` (caps)
    If this is the first push to that ref, `oldSha` could be all zeros (no existing ref). Subsequent lines (if any) would be similar without the \0 caps part.
  * We should verify each update against our current refs in the DB:

    * If `oldSha` doesn’t match the current value of that ref in the DB (and isn’t all zeros when the ref doesn’t exist), it means the client’s view is outdated or it’s not a fast-forward push. In a normal Git server, this would reject the push (non-fast-forward or missing common base). Since we might not enforce all Git policies, we could still reject if it’s not an exact match unless we intend to allow force-push. E.g., simplest rule: if the current stored value != `oldSha` and `oldSha` isn’t the all-zero ID, then fail that ref update (to prevent accidental ref overwrites). The `delete-refs` capability we advertised means we do allow deletion: if `newSha` is all zeros, they want to delete the ref – that’s okay if our current ref value matches `oldSha`.
    * If checks pass (or we choose to ignore and always allow, but better to check), we then plan to update the ref to `newSha` (or delete if newSha is zero).
  * Next, we need to process the packfile in the request. We must **store all the incoming objects** into our database so that future fetches can get them. Parsing a Git packfile involves reading its header and then iterating over each packed object entry. Each entry might be a full object or delta-compressed referencing another object. We have a couple of options here:

    * **Use isomorphic-git or another library**: Since isomorphic-git is a JS implementation of Git, we might actually leverage it on the server side to parse the pack. For example, isomorphic-git has functions to read a packfile stream and output objects. If including that is feasible, it could save time – you’d feed the pack data to a parser, which gives you objects (or you could even use isomorphic-git’s push processing logic partially).
    * **Custom parsing**: The pack format is documented (start with "PACK", version (4 bytes), number of objects (4 bytes), then a series of entries, each entry has a type and size (compactly encoded) and possibly deltas). Writing a full parser might be complex, but for a simple server, an easier route is to **invoke a library**. If using Cloudflare Workers with WASM, one could compile a Git library (like libgit2) to WASM – but that’s heavy. Since isomorphic-git (pure JS) is available, you could include it as a dependency and use its utility to read the pack (note: ensure it doesn't conflict with the client operations).
    * Another approach: Write a minimal parser that relies on isomorphic-git’s packfile utilities or a simpler JS implementation. For push, you might not need to fully apply deltas if you plan to just store the pack as-is. But serving dumb clients requires loose objects or known packs. If we simply store the packfile blob in SQLite, dumb clients can’t pick apart that pack unless we list it in `info/packs` and serve it – which we can do. That’s actually a viable strategy: on receiving a pack, **store the packfile as a blob in the DB** (and possibly its .idx). Then update `objects/info/packs` to include this new pack. This way, a subsequent clone can download this pack directly. This saves us from fully unpacking all objects and writing each to the DB individually. The downside is if someone tries to fetch a single object via dumb after this (instead of grabbing the pack), the object won’t be found loose. However, they would then see the pack via `info/packs` and download it, so it still works. Many static dumb servers actually rely on packs, not loose files, for efficiency. So storing packs might be simpler and more storage-efficient.
    * Alternatively, for completeness, you could unpack all objects: for each object in the pack, resolve any deltas (which requires objects base – either included in the pack or existing) and then insert each object’s raw data into the `objects` table. This makes read paths simpler (each object can be fetched loose). But implementing delta resolution is non-trivial without a library. Given time constraints, a pragmatic approach: **store the entire pack** and mark that ref’s objects as available via that pack. You could later have a background step to unpack them if needed.
  * After storing the new objects (either loose or pack), update the ref(s) in the `refs` table:

    * If `newSha` is all zeros (0000…40), delete that ref row.
    * Otherwise, insert or update that ref with value = newSha.
    * You might also update HEAD if a new branch is created and perhaps HEAD was previously unborn – but in a bare repo HEAD usually remains the default branch unless explicitly changed. Typically, pushing to a new branch doesn’t change HEAD; HEAD is more of a repository config.
  * Construct a response to the push. Because we (likely) advertised `report-status`, the client expects a detailed status report. This is a pkt-line formatted response with content-type `application/x-git-receive-pack-result`. The format is:

    1. A line indicating unpacking result: `"unpack ok\n"` or `"unpack <error message>\n"`. If we were able to apply the pack (store objects) successfully, use "unpack ok". If there was some error processing the pack, we could send "unpack error <message>".
    2. Then one line per ref update attempted: either `"ok <ref>\n"` if that ref was updated, or `"ng <ref> <reason>\n"` if it failed. For example, if the client tried to push to `refs/heads/master`, we might send `ok refs/heads/master` on success, or `ng refs/heads/master some error` if we rejected it (e.g., non-fast-forward).
    3. Finally, a flush pkt (`0000`) to terminate the report.
       This corresponds to the **report-status** capability documentation.
  * Send the response. Isomorphic-git will parse this to determine if the push succeeded. For instance, the pygit example expects the first line to be `unpack ok`. If it’s not, or if an `ng` is present, it knows the push failed.
  * If we did not advertise `report-status`, the server could just close the connection after accepting, but then the client wouldn’t know if it succeeded. Isomorphic-git actually **expects** some response; a Git client when not receiving report-status might assume success if connection isn’t aborted, but to be safe, implement the report.

**Example:** The *pygit* project (a minimal Git client in Python) demonstrates the push sequence. It constructs a push pack and sends it to `/git-receive-pack`, then asserts the response starts with "unpack ok". The code looks like:

```python
lines = ['{} {} refs/heads/master\x00 report-status'.format(old, new).encode()]
data = build_lines_data(lines) + create_pack(missing_objects)
url = repo_url + '/git-receive-pack'
response = http_request(url, auth, data=data)
response_lines = extract_lines(response)
assert response_lines[0] == b'unpack ok\n', "expected unpack ok, got {}".format(response_lines[0])
```

This shows the client sending an update command with `report-status` and expecting an "unpack ok" line in return. Our server should meet those expectations for compatibility.

## Implementation Patterns and Examples

Building a Git server at this low level is complex, but it has been done in various forms:

* **Static dumb server**: As mentioned, serving a bare repo with a static file server (and running `git update-server-info` after any changes) is the classic approach. Our design essentially mimics this, but dynamically from a database.
* **Isomorphic-git** itself can act as a server: The isomorphic-git project includes a `git-http-mock-server` for tests which wraps the Git CLI’s `git-http-backend` to serve repos. That uses the fully smart protocol via the actual Git implementation. In our case, we avoid needing `git-http-backend` by implementing the protocol ourselves.
* **go-git** (a pure Go Git library) also has HTTP server capabilities. It uses similar techniques: it can serve dumb HTTP by generating info/refs and objects, and has issues logged about implementing `update-server-info`. Looking at go-git or JGit (Java Git library) server examples could provide insight on ref advertisement and pack handling logic.
* **Cloudflare Workers + Git**: The Gitlip blog “Infinite Git Repos on Cloudflare Workers” shows an advanced approach where they compiled libgit2 to WASM and built a filesystem on top of Durable Objects. They ended up writing their own Git server logic because libgit2 lacked server-side functions. Our approach is simpler (we don’t run a full Git library; we implement just enough protocol), but that blog confirms Durable Objects are a viable way to host many git repos. They mention using DO’s storage for consistency and even achieving horizontal scale. We similarly rely on DO’s strong consistency and transactional storage (SQLite or DO KV) for our single-repo instance.
* **SQLite as Git storage**: While not common in production, storing Git data in a database has been explored. Projects like `dulwich` (Python) or custom Git implementations sometimes abstract the object store. Our SQLite schema is custom, but it’s straightforward. The benefit is we can query and update atomically (e.g., wrap push in a SQL transaction to update multiple refs and objects safely).
* **Update-server-info analog**: In a file-based dumb server, one must run `git update-server-info` after pushes to regenerate `info/refs` and `objects/info/packs`. In our case, since the server generates `info/refs` on the fly from the DB, we don’t need a separate step – just ensure the DB is updated. If we store pack info, we should update the packs list as part of a push. We could incorporate that into the push handling logic (e.g., after writing a new pack blob, insert a row in `packs` table and it will instantly reflect in `objects/info/packs` output).

**Compatibility with isomorphic-git:** Modern isomorphic-git versions do support dumb HTTP fetch. If a server doesn’t respond with the smart protocol, isomorphic-git will attempt the dumb protocol. In fact, as noted in an issue discussion, isomorphic-git will try fetching loose objects and only GET `objects/info/packs` if it encounters a 404 for a loose object. This matches the behavior of core Git. So our implementation will work with isomorphic-git for cloning/fetching as long as we properly serve `info/refs`, `HEAD`, and objects (and optionally packs). For pushing, isomorphic-git uses the smart protocol (HTTP POST). By implementing the `info/refs?service=git-receive-pack` and POST `/git-receive-pack` as described, we ensure isomorphic-git’s `git.push()` can talk to our server. We should test with isomorphic-git in a Node or browser environment using our DO URL as remote to confirm. The lack of authentication is fine (isomorphic-git can pass empty credentials or none, and our server just doesn’t check).

## Conclusion

To build the server:

1. **Design the Durable Object** to route requests for the repo to the appropriate handler (HEAD, info/refs, object, pack, receive-pack, etc.).
2. **Use SQLite** (via D1 or embedded) as the single source of truth for refs and objects. Initialize the database for a new repo (perhaps create a HEAD with a default branch, or allow pushing the first commit to set it up).
3. **Implement the Dumb HTTP endpoints** (`HEAD`, `info/refs`, `objects/*`, `info/packs`) to serve data from the DB in the exact format Git clients expect. Pay attention to formatting (tabs, newlines, sorting, peeled refs) and headers (status codes, content type).
4. **Implement push support** by handling the smart protocol minimally: advertise capabilities and existing refs, accept a packfile upload, update the SQLite DB (objects and refs), and respond with success/failure status. This component will likely be the most complex – you may leverage existing Git libraries for pack parsing, or store packs wholesale as an interim solution.
5. **Ensure consistency**: After a push, the next fetch should see the new refs. With a transactional DB and DO’s sequential processing, this is achievable. Also, consider garbage collection or pack compaction if many pushes happen (loose objects could be packed periodically to keep performance).
6. **Testing**: Use isomorphic-git as a client – try cloning from the DO server and pushing to it. Also test with the Git CLI (`git clone http://...` and `git push http://...`) to ensure compatibility (the Git CLI will prompt for creds for push if the server uses auth, but since we don’t require auth, it might allow push with an empty password – or you might need to configure it to allow anonymous push, which by default Git HTTP server doesn’t. We might have to send an HTTP 200 even for push with no auth header to simulate “anonymous allowed”).

By supporting the above pieces, we fulfill the requirements: a simple Git server on Cloudflare’s edge, speaking dumb HTTP for reads, and handling writes in a basic smart way. This setup is lightweight and leverages Cloudflare’s global network and transactional storage for speed and consistency. In summary, **implementing the dumb HTTP protocol means serving the Git repository as a set of files over HTTP**, which we have mapped to DO handlers reading an SQLite backend. With these in place, isomorphic-git (and other clients) can clone (pull) and push to the repository seamlessly over HTTP.

**Sources:**

* Git HTTP protocol documentation (dumb vs smart)
* Stack Overflow – explanation of `.git/objects/info/packs` and dumb transport needs
* Example of setting up and serving a dumb HTTP repo (with update-server-info)
* Ben Hoyt’s *pygit* illustrating a custom push implementation (demonstrates the pack upload and expected response).

