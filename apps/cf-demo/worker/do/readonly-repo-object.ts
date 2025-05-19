import { DurableObject } from "cloudflare:workers";
import git, {
  type CommitObject,
  type GitProgressEvent,
  type ReadCommitResult,
} from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { DurableObjectSqliteAdapter } from "sqlite-fs/do";
import { SQLiteFSAdapter } from "sqlite-fs";
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

export class ReadonlyRepoObject extends DurableObject {
  private repoName: string;
  private status: STATUS;
  private _fsAdapter?: SQLiteFSAdapter;
  private _files: FileEntry[] | null = null;
  private _commitInfo: CommitInfo | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.repoName = "";
    this.status = "new";
    ctx.blockConcurrencyWhile(async () => {
      this.repoName = (await ctx.storage.get("repoName")) || "";
      this.status = (await ctx.storage.get("status")) || "new";
    });
  }

  async fetch(_request: Request): Promise<Response> {
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

    const repoUrl = `https://github.com/${this.repoName}.git`;
    const onMessage = (message: string) => console.log(message);
    const onProgress = (progress: GitProgressEvent) => {
      this.broadcast({
        type: "progress",
        progress,
      });
    };
    await git.clone({
      fs: this.fsAdapter,
      http,
      dir: ".",
      url: repoUrl,
      singleBranch: true,
      noCheckout: true,
      depth: 1,
      onMessage,
      onProgress,
    });
    this.setStatus("ready");
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
