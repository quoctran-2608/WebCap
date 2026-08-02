import { spawn, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { env, stdout } from "node:process";

const REMOTE_DEBUGGING_PORT = 9333;
const STARTUP_TIMEOUT_MS = 20_000;
const CONNECT_TIMEOUT_MS = 10_000;

function findChromeBinary() {
  if (env.CHROME_BIN) {
    return env.CHROME_BIN;
  }

  for (const candidate of [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
  ]) {
    const result = spawnSync("which", [candidate], { encoding: "utf8" });
    if (result.status === 0) {
      return result.stdout.trim();
    }
  }

  throw new Error("A Chrome or Chromium binary is required for the extension smoke test.");
}

function extensionIdFromPublicKey(publicKey) {
  const digest = createHash("sha256").update(publicKey).digest().subarray(0, 16);
  return [...digest]
    .flatMap((byte) => [byte >> 4, byte & 15])
    .map((nibble) => String.fromCharCode("a".charCodeAt(0) + nibble))
    .join("");
}

async function waitForJson(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await globalThis.fetch(url);
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolveDelay) => globalThis.setTimeout(resolveDelay, 150));
  }

  throw new Error(`Timed out waiting for ${url}. ${String(lastError ?? "")}`);
}

class CdpClient {
  #nextId = 1;
  #pending = new Map();

  constructor(socket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (typeof message.id !== "number") {
        return;
      }

      const pending = this.#pending.get(message.id);
      if (!pending) {
        return;
      }

      this.#pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result);
      }
    });
  }

  send(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolveMessage, rejectMessage) => {
      this.#pending.set(id, { resolve: resolveMessage, reject: rejectMessage });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function connectWebSocket(url) {
  const socket = new globalThis.WebSocket(url);
  await new Promise((resolveOpen, rejectOpen) => {
    const timeout = globalThis.setTimeout(
      () => rejectOpen(new Error("Timed out opening CDP websocket.")),
      CONNECT_TIMEOUT_MS,
    );
    socket.addEventListener("open", () => {
      globalThis.clearTimeout(timeout);
      resolveOpen();
    });
    socket.addEventListener("error", () => {
      globalThis.clearTimeout(timeout);
      rejectOpen(new Error("Failed to open CDP websocket."));
    });
  });
  return socket;
}

async function waitForConnectedStatus(client) {
  const deadline = Date.now() + CONNECT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const evaluation = await client.send("Runtime.evaluate", {
      expression:
        "document.querySelector('[data-testid=\"worker-status\"]')?.getAttribute('data-status')",
      returnByValue: true,
    });
    const status = evaluation.result?.value;

    if (status === "connected") {
      return;
    }

    if (status === "unavailable") {
      throw new Error("Popup reported that the service worker was unavailable.");
    }

    await new Promise((resolveDelay) => globalThis.setTimeout(resolveDelay, 100));
  }

  throw new Error("Popup did not reach the connected service-worker state.");
}

const projectRoot = resolve(import.meta.dirname, "../..");
const tempRoot = await mkdtemp(join(tmpdir(), "webcap-s01-"));
const extensionDirectory = join(tempRoot, "extension");
const profileDirectory = join(tempRoot, "profile");
let browser;
let browserOutput = "";

try {
  await cp(resolve(projectRoot, "dist"), extensionDirectory, { recursive: true });

  const manifestPath = join(extensionDirectory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const { publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
  });
  manifest.key = publicKey.toString("base64");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const extensionId = extensionIdFromPublicKey(publicKey);
  const popupUrl = `chrome-extension://${extensionId}/popup.html`;
  const chromeBinary = findChromeBinary();

  browser = spawn(
    chromeBinary,
    [
      "--no-sandbox",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${REMOTE_DEBUGGING_PORT}`,
      `--user-data-dir=${profileDirectory}`,
      `--disable-extensions-except=${extensionDirectory}`,
      `--load-extension=${extensionDirectory}`,
      popupUrl,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  browser.stdout.on("data", (chunk) => {
    browserOutput += chunk.toString();
  });
  browser.stderr.on("data", (chunk) => {
    browserOutput += chunk.toString();
  });

  await waitForJson(
    `http://127.0.0.1:${REMOTE_DEBUGGING_PORT}/json/version`,
    STARTUP_TIMEOUT_MS,
  );

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let popupTarget;
  while (Date.now() < deadline && !popupTarget) {
    const targets = await waitForJson(
      `http://127.0.0.1:${REMOTE_DEBUGGING_PORT}/json/list`,
      STARTUP_TIMEOUT_MS,
    );
    popupTarget = targets.find((target) => target.url === popupUrl);
    if (!popupTarget) {
      await new Promise((resolveDelay) => globalThis.setTimeout(resolveDelay, 150));
    }
  }

  if (!popupTarget?.webSocketDebuggerUrl) {
    throw new Error(`Popup target was not created. Browser output:\n${browserOutput}`);
  }

  const socket = await connectWebSocket(popupTarget.webSocketDebuggerUrl);
  const client = new CdpClient(socket);
  await client.send("Runtime.enable");
  await waitForConnectedStatus(client);
  socket.close();

  stdout.write(`Verified popup ↔ service worker handshake for extension ${extensionId}.\n`);
} catch (error) {
  throw new Error(
    `${error instanceof Error ? error.message : String(error)}\nBrowser output:\n${browserOutput}`,
  );
} finally {
  browser?.kill("SIGTERM");
  await rm(tempRoot, { recursive: true, force: true });
}
