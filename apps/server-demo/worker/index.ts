import { studio } from "@outerbase/browsable-durable-object";
import { env } from "cloudflare:workers";
import { Hono, type HonoRequest } from "hono";

const app = new Hono();

async function getRepoObject(request: HonoRequest) {
  const repoName = `${request.param("user")}/${request.param("repo")}`;
  const id = env.SERVABLE_REPO.idFromName(repoName);
  const stub = env.SERVABLE_REPO.get(id);
  await stub.initialize(repoName);
  return stub;
}

app.get("/api/", (c) => c.json({ name: "Hello Cloudflare Workers!" }));
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

// Git dumb protocol endpoints
app.get("/:user/:repo/HEAD", async (c) => {
  const stub = await getRepoObject(c.req);
  const head = await stub.getHead();
  console.log("HEAD:", head);
  return new Response(head, {
    headers: { "Content-Type": "text/plain" },
  });
});

app.get("/:user/:repo/info/refs", async (c) => {
  const stub = await getRepoObject(c.req);
  const refs = await stub.getRefs();
  console.log("Refs:", refs);
  return new Response(refs, {
    headers: {
      "Content-Type": "text/plain",
      "Cache-Control": "no-cache",
    },
  });
});

app.get("/:user/:repo/objects/:dir/:file", async (c) => {
  const stub = await getRepoObject(c.req);
  const dir = c.req.param("dir");
  const file = c.req.param("file");
  const objectId = dir + file;

  try {
    const object = await stub.getObject(objectId);
    console.log("Object found", objectId);
    return new Response(object, {
      headers: { "Content-Type": "application/octet-stream" },
    });
  } catch (error) {
    console.log("Object not found", objectId, error);
    return new Response("Not Found", { status: 404 });
  }
});

app.get("/:user/:repo/objects/info/packs", async (c) => {
  const stub = await getRepoObject(c.req);
  const packs = await stub.getPacks();
  return new Response(packs, {
    headers: { "Content-Type": "text/plain" },
  });
});

app.get("/studio", async (c) => {
  return await studio(c.req.raw, env.SERVABLE_REPO, {});
});

export { ServableRepoObject } from "./do/servable-repo-object";

export default app;
