import { Hono } from "hono";
import { env } from "cloudflare:workers";
export { ReadonlyRepoObject } from "./do/readonly-repo-object";
const app = new Hono();

app.get("/api/", (c) => c.json({ name: "Hello Cloudflare Workers!" }));
app.get("/api/:user/:repo/status", async (c) => {
  const repoName = `${c.req.param("user")}/${c.req.param("repo")}`;
  const id = env.READONLY_REPO.idFromName(repoName);
  const stub = env.READONLY_REPO.get(id);
  await stub.initialize(repoName);
  const status = await stub.status();
  return c.json({ status });
});

export default app;
