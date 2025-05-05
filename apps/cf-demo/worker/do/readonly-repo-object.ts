import { DurableObject } from "cloudflare:workers";

export class ReadonlyRepoObject extends DurableObject {
  repoName: string;

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

  async status() {
    return "ok";
  }
}
