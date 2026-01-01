import { BrowsableHandler } from "@outerbase/browsable-durable-object";
import { DurableObject } from "cloudflare:workers";
import git, {
  type GitProgressEvent,
  type ReadCommitResult,
} from "isomorphic-git";
import http from "isomorphic-git/http/web";
import * as pako from "pako";
import { SQLiteFSAdapter } from "sqlite-fs";
import { DurableObjectSqliteAdapter } from "sqlite-fs/do";
import { type FileEntry, walkTree } from "../lib/walk-tree";
import {
  concatBytes,
  decodePktText,
  encodePktFlush,
  encodePktLine,
  readPktLinesUntilFlush,
} from "../lib/pkt-line";

type STATUS = "new" | "cloning" | "ready" | "fetching" | "error";

type RefUpdate = {
  oldOid: string;
  newOid: string;
  ref: string;
};

type RefUpdateResult =
  | { ref: string; status: "ok" }
  | { ref: string; status: "ng"; reason: string };

const ZERO_OID = "0".repeat(40);
const MAX_PACK_SIZE = 30 * 1024 * 1024;
const RECEIVE_PACK_AGENT = "cf-git/1.0";

export interface Message {
  type: string;
}
export interface Init extends Message {
  type: "init";
  repoName: string;
}

export interface Clone extends Message {
  type: "clone";
}
export interface Fetch extends Message {
  type: "fetch";
}

export interface Status extends Message {
  type: "status";
  status: STATUS;
  commitInfo?: CommitInfo;
}

export interface Progress extends Message {
  type: "progress";
  progress: GitProgressEvent;
}

export type Commands = Init | Clone | Fetch;
export type Events = Status | Progress;

export type CommitInfo = {
  branch: string | undefined;
  commit: ReadCommitResult | undefined;
};

export class ServableRepoObject extends DurableObject {
  private repoName: string;
  private status: STATUS;
  private _fsAdapter?: SQLiteFSAdapter;
  private _files: FileEntry[] | null = null;
  private _commitInfo: CommitInfo | null = null;
  private browsable: BrowsableHandler;
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.repoName = "";
    this.status = "new";
    this.sql = ctx.storage.sql;
    this.browsable = new BrowsableHandler(this.sql);
    ctx.blockConcurrencyWhile(async () => {
      this.repoName = (await ctx.storage.get("repoName")) || "";
      this.status = (await ctx.storage.get("status")) || "new";
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/query/raw") {
      return await this.browsable.fetch(request);
    }

    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    this.ctx.acceptWebSocket(server!);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    const msg = JSON.parse(message.toString());
    if (msg.type === "init") {
      const commitInfo = await this.getLastCommit();
      ws.send(
        JSON.stringify({ type: "status", status: this.status, commitInfo }),
      );
    } else if (msg.type === "clone") {
      await this.clone();
    } else if (msg.type === "fetch") {
      await this.gitFetch();
    }
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    _reason: string,
    _wasClean: boolean,
  ) {
    // If the client closes the connection, the runtime will invoke the webSocketClose() handler.
    ws.close(code, "Durable Object is closing WebSocket");
  }

  async initialize(repoName: string) {
    if (this.repoName) {
      return;
    }
    this.repoName = repoName;

    this.ctx.blockConcurrencyWhile(async () => {
      await this.ctx.storage.put("repoName", repoName);
    });
  }

  async clone() {
    if (this.status !== "new") {
      return;
    }
    this.status = "cloning";
    await this.setStatus("cloning");

    try {
      await git.init({
        fs: this.fsAdapter,
        dir: ".",
      });
      console.log("Initialized git repository");
      await this.fsAdapter.writeFile(
        "README.md",
        `# ${this.repoName}\n\nThis repository was cloned into a Cloudflare Durable Object.`,
      );
      console.log("Created README.md file");
      await git.add({
        fs: this.fsAdapter,
        dir: ".",
        filepath: "README.md",
      });
      console.log("Added README.md file to staging area");
      await git.commit({
        fs: this.fsAdapter,
        dir: ".",
        author: {
          name: "Mr. Test",
          email: "mrtest@example.com",
        },
        message: "Added the a.txt file",
      });
      console.log("Committed README.md file");
      this.setStatus("ready");
    } catch (error) {
      console.error("Error initializing repository:", error);
      return;
    }
  }

  async gitFetch() {
    if (this.status !== "ready") {
      return;
    }
    this.status = "fetching";
    this.setStatus("fetching");

    const repoUrl = `https://github.com/${this.repoName}.git`;
    const onMessage = (message: string) => console.log(message);
    const onProgress = (progress: GitProgressEvent) => {
      this.broadcast({
        type: "progress",
        progress,
      });
    };
    await git.fetch({
      fs: this.fsAdapter,
      http,
      dir: ".",
      url: repoUrl,
      singleBranch: true,
      depth: 1,
      onProgress,
      onMessage,
    });
    this.setStatus("ready");
  }

  async listFiles(): Promise<FileEntry[]> {
    if (this._files) {
      return this._files;
    }
    this._files = await walkTree({
      fs: this.fsAdapter,
      repoDir: ".",
    });
    return this._files || [];
  }

  async getBlob(oid: string) {
    const blob = await git.readBlob({
      fs: this.fsAdapter,
      dir: ".",
      oid,
    });
    return blob;
  }

  async getHead(): Promise<string> {
    try {
      const branch = await git.currentBranch({
        fs: this.fsAdapter,
        dir: ".",
      });
      if (branch) {
        return `ref: refs/heads/${branch}\n`;
      }
      // Fallback to HEAD commit if detached
      const commits = await git.log({
        fs: this.fsAdapter,
        dir: ".",
        depth: 1,
      });
      return commits[0]?.oid || "";
    } catch (error) {
      return "ref: refs/heads/main\n"; // Default fallback
    }
  }

  async getRefs(): Promise<string> {
    try {
      const refs = await git.listBranches({
        fs: this.fsAdapter,
        dir: ".",
      });

      const tags = await git.listTags({
        fs: this.fsAdapter,
        dir: ".",
      });

      const refLines: string[] = [];

      // Add branches
      for (const branch of refs) {
        const commit = await git.resolveRef({
          fs: this.fsAdapter,
          dir: ".",
          ref: `refs/heads/${branch}`,
        });
        refLines.push(`${commit}\trefs/heads/${branch}`);
      }

      // Add tags
      for (const tag of tags) {
        const commit = await git.resolveRef({
          fs: this.fsAdapter,
          dir: ".",
          ref: `refs/tags/${tag}`,
        });
        refLines.push(`${commit}\trefs/tags/${tag}`);

        // Check if it's an annotated tag and add peeled reference
        try {
          const tagObject = await git.readTag({
            fs: this.fsAdapter,
            dir: ".",
            oid: commit,
          });
          if (tagObject.object !== commit) {
            refLines.push(`${tagObject.object}\trefs/tags/${tag}^{}`);
          }
        } catch (error) {
          // Not an annotated tag, skip peeled reference
        }
      }

      // Sort by ref name
      refLines.sort((a, b) => a.split("\t")[1].localeCompare(b.split("\t")[1]));

      return refLines.join("\n") + "\n";
    } catch (error) {
      return "";
    }
  }

  async getObject(objectId: string): Promise<Uint8Array> {
    try {
      // Read the raw object from the filesystem adapter
      // The SQLite FS adapter should already store objects in Git's compressed format
      const objectPath = `objects/${objectId.slice(0, 2)}/${objectId.slice(2)}`;

      try {
        const compressed = await this.fsAdapter.readFile(objectPath, {
          encoding: "binary",
        });

        return new Uint8Array(compressed as Buffer);
      } catch (fsError) {
        console.log("FS error reading object, falling back to git", fsError);
        // Fallback: try to get object via isomorphic-git and format it properly
        const { object, type } = await git.readObject({
          fs: this.fsAdapter,
          dir: ".",
          oid: objectId,
          format: "deflated",
        });

        if (type === "deflated") {
          return object;
        }

        const content = object as Uint8Array;
        const header = `${type} ${content.length}\0`;
        const headerBytes = new TextEncoder().encode(header);

        // Combine header and content
        const combined = new Uint8Array(headerBytes.length + content.length);
        combined.set(headerBytes, 0);
        combined.set(content, headerBytes.length);

        // Compress with zlib using pako (this is what Git expects)
        const compressed = pako.deflate(combined);
        return compressed;
      }
    } catch (error) {
      console.log("Error reading object:", error);
      throw new Error(`Object ${objectId} not found`);
    }
  }

  private async getObjectType(objectId: string): Promise<string> {
    try {
      const { type } = await git.readObject({
        fs: this.fsAdapter,
        dir: ".",
        oid: objectId,
      });
      return type;
    } catch (error) {
      return "blob"; // Default fallback
    }
  }

  async getPacks(): Promise<string> {
    // For now, return empty - we're serving loose objects
    // In the future, this could list packfiles stored in the SQLite DB
    return "";
  }

  async getReceivePackAdvertisement(): Promise<Uint8Array> {
    await this.ensureGitRepoInitialized();

    const serviceHeader = concatBytes([
      encodePktLine("# service=git-receive-pack\n"),
      encodePktFlush(),
    ]);

    const refs = await this.listRefsForAdvertisement();
    const headTarget = await this.getHeadTargetRef();

    const capabilities = [
      "report-status",
      "delete-refs",
      "ofs-delta",
      `symref=HEAD:${headTarget}`,
      `agent=${RECEIVE_PACK_AGENT}`,
    ].join(" ");

    const advertised: Array<{ oid: string; name: string }> = [];
    const headOid = await this.resolveRefOrZero("HEAD");
    if (headOid !== ZERO_OID) {
      advertised.push({ oid: headOid, name: "HEAD" });
    }
    advertised.push(...refs);

    const pktLines: Uint8Array[] = [];
    if (advertised.length === 0) {
      pktLines.push(
        encodePktLine(`${ZERO_OID} capabilities^{}\0${capabilities}\n`),
      );
    } else {
      const [first, ...rest] = advertised;
      pktLines.push(encodePktLine(`${first.oid} ${first.name}\0${capabilities}\n`));
      for (const ref of rest) {
        pktLines.push(encodePktLine(`${ref.oid} ${ref.name}\n`));
      }
    }
    pktLines.push(encodePktFlush());

    return concatBytes([serviceHeader, ...pktLines]);
  }

  async receivePack(data: Uint8Array): Promise<Uint8Array> {
    await this.ensureGitRepoInitialized();

    const { lines: commandLines, offset } = readPktLinesUntilFlush(data, 0);
    const commandsText = commandLines.map(decodePktText);
    const updates = this.parseRefUpdates(commandsText);

    const remaining = data.slice(offset);
    const hasPack =
      remaining.length >= 4 &&
      remaining[0] === 0x50 &&
      remaining[1] === 0x41 &&
      remaining[2] === 0x43 &&
      remaining[3] === 0x4b;

    const unpackResult = hasPack
      ? await this.processPackfile(remaining)
      : { ok: true as const };

    const refResults = unpackResult.ok
      ? await this.updateRefs(updates)
      : updates.map((u) => ({
          ref: u.ref,
          status: "ng" as const,
          reason: "unpack failed",
        }));

    if (unpackResult.ok) {
      await this.maybeUpdateHeadAfterPush(refResults);
    }

    return this.buildReportStatus(unpackResult, refResults);
  }

  async getStatus(): Promise<STATUS> {
    return this.status;
  }

  async getLastCommit() {
    if (this._commitInfo) {
      return this._commitInfo;
    }
    if (this.status !== "ready") {
      return undefined;
    }
    const branch = await git.currentBranch({
      fs: this.fsAdapter,
      dir: ".",
    });
    const commits = await git.log({
      fs: this.fsAdapter,
      dir: ".",
      depth: 1,
    });
    this._commitInfo = {
      branch: branch || undefined,
      commit: commits[0] || undefined,
    };
    return this._commitInfo;
  }

  private async setStatus(status: STATUS) {
    this.status = status;
    await this.ctx.storage.put("status", status);
    const commitInfo = await this.getLastCommit();
    this.broadcast({ type: "status", status, commitInfo });
  }

  private broadcast(message: Events) {
    const webSockets = this.ctx.getWebSockets();
    for (const ws of webSockets) {
      ws.send(JSON.stringify(message));
    }
  }

  private get fsAdapter() {
    if (this._fsAdapter) {
      return this._fsAdapter;
    }
    const dbAdapter = new DurableObjectSqliteAdapter(this.ctx.storage);
    this._fsAdapter = new SQLiteFSAdapter(dbAdapter);
    return this._fsAdapter;
  }

  private async ensureGitRepoInitialized(): Promise<void> {
    try {
      await this.fsAdapter.stat(".git");
      return;
    } catch {
      // Fall through to init
    }

    try {
      // defaultBranch is supported by modern isomorphic-git.
      await git.init({
        fs: this.fsAdapter,
        dir: ".",
        defaultBranch: "main",
      } as any);
    } catch (error) {
      // If init fails due to unexpected option shape, retry with the minimal call.
      await git.init({
        fs: this.fsAdapter,
        dir: ".",
      } as any);
    }
  }

  private async resolveRefOrZero(ref: string): Promise<string> {
    try {
      return await git.resolveRef({
        fs: this.fsAdapter,
        dir: ".",
        ref,
      });
    } catch {
      return ZERO_OID;
    }
  }

  private async getHeadTargetRef(): Promise<string> {
    try {
      const branch = await git.currentBranch({
        fs: this.fsAdapter,
        dir: ".",
      });
      if (branch) return `refs/heads/${branch}`;
    } catch {
      // ignore
    }
    return "refs/heads/main";
  }

  private async listRefsForAdvertisement(): Promise<
    Array<{ oid: string; name: string }>
  > {
    const advertised: Array<{ oid: string; name: string }> = [];
    try {
      const branches = await git.listBranches({
        fs: this.fsAdapter,
        dir: ".",
      });
      for (const branch of branches) {
        const oid = await this.resolveRefOrZero(`refs/heads/${branch}`);
        if (oid !== ZERO_OID) {
          advertised.push({ oid, name: `refs/heads/${branch}` });
        }
      }

      const tags = await git.listTags({
        fs: this.fsAdapter,
        dir: ".",
      });
      for (const tag of tags) {
        const tagRef = `refs/tags/${tag}`;
        const oid = await this.resolveRefOrZero(tagRef);
        if (oid !== ZERO_OID) {
          advertised.push({ oid, name: tagRef });
        }

        // Peeled ref for annotated tags
        if (oid !== ZERO_OID) {
          try {
            const tagObject = await git.readTag({
              fs: this.fsAdapter,
              dir: ".",
              oid,
            });
            if (tagObject.object && tagObject.object !== oid) {
              advertised.push({ oid: tagObject.object, name: `${tagRef}^{}` });
            }
          } catch {
            // Not an annotated tag
          }
        }
      }
    } catch {
      // If listing refs fails, advertise nothing beyond capabilities.
    }

    advertised.sort((a, b) => a.name.localeCompare(b.name));
    return advertised;
  }

  private parseRefUpdates(commandLines: string[]): RefUpdate[] {
    const updates: RefUpdate[] = [];
    for (let i = 0; i < commandLines.length; i++) {
      const line = commandLines[i];
      const trimmed = line.endsWith("\n") ? line.slice(0, -1) : line;
      const [commandPart] = i === 0 ? trimmed.split("\0") : [trimmed];
      if (!commandPart) continue;
      const parts = commandPart.trim().split(/\s+/);
      if (parts.length < 3) continue;
      const [oldOid, newOid, ref] = parts;
      updates.push({ oldOid, newOid, ref });
    }
    return updates;
  }

  private async processPackfile(
    packData: Uint8Array,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (packData.length > MAX_PACK_SIZE) {
      return { ok: false, error: "error: pack too large" };
    }

    try {
      await this.ensureDir(".git/objects/pack");
      const filename = `incoming-${Date.now()}-${Math.random().toString(16).slice(2)}.pack`;
      const packPath = `.git/objects/pack/${filename}`;
      await this.fsAdapter.writeFile(packPath, packData);

      await git.indexPack({
        fs: this.fsAdapter,
        dir: ".",
        filepath: packPath,
      } as any);
      return { ok: true };
    } catch (error: any) {
      console.error("indexPack failed", error);
      return { ok: false, error: `error: ${error?.message || "index-pack failed"}` };
    }
  }

  private async ensureDir(path: string): Promise<void> {
    const parts = path.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      try {
        await this.fsAdapter.mkdir(current);
      } catch (error: any) {
        if (error?.code !== "EEXIST") throw error;
      }
    }
  }

  private async updateRefs(updates: RefUpdate[]): Promise<RefUpdateResult[]> {
    const results: RefUpdateResult[] = [];
    for (const update of updates) {
      const { oldOid, newOid, ref } = update;

      if (!ref.startsWith("refs/")) {
        results.push({ ref, status: "ng", reason: "invalid ref" });
        continue;
      }

      const currentOid = await this.resolveRefOrZero(ref);
      if (oldOid !== currentOid) {
        results.push({ ref, status: "ng", reason: "non-fast-forward" });
        continue;
      }

      try {
        if (newOid === ZERO_OID) {
          await git.deleteRef({
            fs: this.fsAdapter,
            dir: ".",
            ref,
          } as any);
        } else {
          await git.writeRef({
            fs: this.fsAdapter,
            dir: ".",
            ref,
            value: newOid,
            force: true,
          } as any);
        }
        results.push({ ref, status: "ok" });
      } catch (error: any) {
        results.push({
          ref,
          status: "ng",
          reason: error?.message || "ref update failed",
        });
      }
    }
    return results;
  }

  private buildReportStatus(
    unpack:
      | { ok: true }
      | {
          ok: false;
          error: string;
        },
    refResults: RefUpdateResult[],
  ): Uint8Array {
    const lines: Uint8Array[] = [];
    if (unpack.ok) {
      lines.push(encodePktLine("unpack ok\n"));
    } else {
      lines.push(encodePktLine(`unpack ${unpack.error}\n`));
    }

    for (const result of refResults) {
      if (result.status === "ok") {
        lines.push(encodePktLine(`ok ${result.ref}\n`));
      } else {
        lines.push(encodePktLine(`ng ${result.ref} ${result.reason}\n`));
      }
    }
    lines.push(encodePktFlush());
    return concatBytes(lines);
  }

  private async maybeUpdateHeadAfterPush(
    results: RefUpdateResult[],
  ): Promise<void> {
    const headOid = await this.resolveRefOrZero("HEAD");
    if (headOid !== ZERO_OID) {
      return;
    }

    // HEAD is either unborn or points at a missing ref. Prefer pointing HEAD at a
    // successfully-updated branch (ideally refs/heads/main).
    const headCandidates = results
      .filter((r): r is { ref: string; status: "ok" } => r.status === "ok")
      .map((r) => r.ref)
      .filter((ref) => ref.startsWith("refs/heads/"));
    if (headCandidates.length === 0) return;

    const target =
      headCandidates.find((r) => r === "refs/heads/main") ?? headCandidates[0];

    try {
      await this.fsAdapter.writeFile(".git/HEAD", `ref: ${target}\n`);
    } catch {
      // ignore
    }
  }
}
