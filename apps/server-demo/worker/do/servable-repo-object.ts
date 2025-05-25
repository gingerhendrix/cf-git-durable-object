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

type STATUS = "new" | "cloning" | "ready" | "fetching" | "error";

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
}
