import { Hono, HonoRequest } from "hono";
import { env } from "cloudflare:workers";
import { ReadonlyRepoObject } from "./do/readonly-repo-object";
export { ReadonlyRepoObject } from "./do/readonly-repo-object";
const app = new Hono();

async function getRepoObject(request: HonoRequest) {
  const repoName = `${request.param("user")}/${request.param("repo")}`;
  const id = env.READONLY_REPO.idFromName(repoName);
  const stub = env.READONLY_REPO.get(
    id,
  ) as DurableObjectStub<ReadonlyRepoObject>;
  await stub.initialize(repoName);
  return stub;
}

app.get("/api/", (c) => c.json({ name: "Hello Cloudflare Workers!" }));
app.get("/api/:user/:repo/status", async (c) => {
  const stub = await getRepoObject(c.req);
  const status = await stub.status();
  return c.json({ status });
});

app.post("/api/:user/:repo/clone", async (c) => {
  const stub = await getRepoObject(c.req);
  await stub.clone();
  return c.json({ status: "ok" });
});
app.post("/api/:user/:repo/ls-files", async (c) => {
  const stub = await getRepoObject(c.req);
  const files = await stub.listFiles();
  return c.json({ files });
});

app.get("/api/:user/:repo/blob/:oid", async (c) => {
  const stub = await getRepoObject(c.req);
  const oid = c.req.param("oid");
  const blob = await stub.getBlob(oid);
  const contents = new TextDecoder().decode(blob.blob);
  return c.json({ blob: contents });
});

export default app;
