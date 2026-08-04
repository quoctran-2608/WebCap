import { Buffer } from "node:buffer";
import { createReadStream, existsSync, statSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
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
  ".pdf": "application/pdf",
};

const pdfDocument = await PDFDocument.create();
const pdfPage = pdfDocument.addPage([360, 540]);
const pdfFont = await pdfDocument.embedFont(StandardFonts.Helvetica);
pdfPage.drawText("WebCap original PDF passthrough fixture", {
  x: 36,
  y: 480,
  size: 18,
  font: pdfFont,
  color: rgb(0.1, 0.35, 0.24),
});
pdfPage.drawText("These bytes must be downloaded without rasterization.", {
  x: 36,
  y: 445,
  size: 11,
  font: pdfFont,
});
const publicPdfBytes = Buffer.from(await pdfDocument.save({ useObjectStreams: false }));

function sendPdf(request, response) {
  response.writeHead(200, {
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Length": String(publicPdfBytes.byteLength),
    "Content-Type": "application/pdf",
    "X-WebCap-Fixture": "original-pdf",
  });
  if (request.method === "HEAD") response.end();
  else response.end(publicPdfBytes);
}

const server = createServer((request, response) => {
  const requestPath = new URL(request.url ?? "/", `http://${host}:${port}`).pathname;

  if (requestPath === "/public-sample.pdf" || requestPath === "/pdf-download") {
    sendPdf(request, response);
    return;
  }

  if (requestPath === "/auth-wrapper") {
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
    });
    response.end(
      '<!doctype html><title>Auth PDF wrapper</title><p>Stable PDF source fixture.</p><script>history.replaceState(null, "", "/auth-required.pdf");</script>',
    );
    return;
  }

  if (requestPath === "/auth-required.pdf") {
    response.writeHead(401, {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "WWW-Authenticate": 'Basic realm="WebCap fixture"',
    });
    response.end("<!doctype html><title>Sign in required</title><p>Authentication required.</p>");
    return;
  }

  if (requestPath === "/invalid-source.pdf") {
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": "application/pdf",
    });
    response.end("not a PDF");
    return;
  }

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
