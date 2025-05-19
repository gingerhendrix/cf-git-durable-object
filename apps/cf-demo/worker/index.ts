import { env } from "cloudflare:workers";
import { Hono, type HonoRequest } from "hono";

const app = new Hono();

async function getRepoObject(request: HonoRequest) {
  const repoName = `${request.param("user")}/${request.param("repo")}`;
  const id = env.READONLY_REPO.idFromName(repoName);
  const stub = env.READONLY_REPO.get(id);
  await stub.initialize(repoName);
  return stub;
}

app.get("/api/", (c) => c.json({ name: "Hello Cloudflare Workers!" }));
app.get("/api/:user/:repo/status", async (c) => {
  const stub = await getRepoObject(c.req);
  const status = await stub.status();
  return c.json({ status });
});

app.get("/api/:user/:repo/ws", async (c) => {
  const upgradeHeader = c.req.header("Upgrade");
  if (!upgradeHeader || upgradeHeader !== "websocket") {
    return new Response("Durable Object expected Upgrade: websocket", {
      status: 426,
    });
  }

  const stub = await getRepoObject(c.req);

  return stub.fetch(c.req.raw);
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

export { ReadonlyRepoObject } from "./do/readonly-repo-object";

export default app;
