import { DurableObject } from "cloudflare:workers";
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { DurableObjectSqliteAdapter } from "../lib/do-sqlite-adapter";
import { SQLiteFSAdapter } from "sqlite-fs";
import { walkTree } from "../lib/walk-tree";

export class ReadonlyRepoObject extends DurableObject {
  private repoName: string;
  private _fsAdapter?: SQLiteFSAdapter;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.repoName = "";
    ctx.blockConcurrencyWhile(async () => {
      this.repoName = (await ctx.storage.get("repoName")) || "";
    });
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
    const repoUrl = `https://github.com/${this.repoName}.git`;
    const onMessage = (message: string) => console.log(message);
    const onProgress = (progress: any) => {
      if (
        progress.phase &&
        progress.loaded !== undefined &&
        progress.total !== undefined
      ) {
        console.log(
          `Phase: ${progress.phase}, Progress: ${progress.loaded}/${progress.total}`,
        );
      } else if (progress.phase) {
        console.log(`Phase: ${progress.phase}`);
      }
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
    console.log("Clone completed successfully.");
  }

  async listFiles() {
    const files = await walkTree({
      fs: this.fsAdapter,
      repoDir: ".",
    });
    return files;
  }

  async getBlob(oid: string) {
    const blob = await git.readBlob({
      fs: this.fsAdapter,
      dir: ".",
      oid,
    });
    return blob;
  }

  async status() {
    return "ok";
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
