import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import process from "node:process";
import { URL } from "node:url";

const fixtureRoot = new URL("../fixtures/", import.meta.url).pathname;
const host = "127.0.0.1";
const port = 4174;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
};

const server = createServer((request, response) => {
  const requestPath = new URL(request.url ?? "/", `http://${host}:${port}`).pathname;
  const relativePath = normalize(
    requestPath === "/" ? "visible-capture.html" : requestPath.slice(1),
  );

  if (relativePath.startsWith("..")) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  const filePath = join(fixtureRoot, relativePath);
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404).end("Not found");
    return;
  }

  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": contentTypes[extname(filePath)] ?? "application/octet-stream",
  });
  createReadStream(filePath).pipe(response);
});

server.listen(port, host, () => {
  process.stdout.write(`WebCap fixture server listening on http://${host}:${port}\n`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
