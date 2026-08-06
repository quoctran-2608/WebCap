import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { arch, platform, tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { argv, env, stdout } from "node:process";

const LAST_KNOWN_GOOD_URL =
  "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json";
const KNOWN_GOOD_URL =
  "https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json";
const ALLOWED_DOWNLOAD_PREFIX = "https://storage.googleapis.com/chrome-for-testing-public/";

function parseArguments(arguments_) {
  const options = {
    channel: null,
    major: null,
    previousStable: false,
    destination: null,
    githubOutputKey: null,
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--channel") {
      options.channel = arguments_[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (argument === "--major") {
      options.major = Number(arguments_[index + 1]);
      index += 1;
      continue;
    }
    if (argument === "--previous-stable") {
      options.previousStable = true;
      continue;
    }
    if (argument === "--destination") {
      options.destination = arguments_[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (argument === "--github-output-key") {
      options.githubOutputKey = arguments_[index + 1] ?? null;
      index += 1;
      continue;
    }
    throw new Error(`Unknown Chrome for Testing argument: ${argument}`);
  }
  const selectors = [
    options.channel !== null,
    options.major !== null,
    options.previousStable,
  ].filter(Boolean).length;
  if (selectors !== 1) {
    throw new Error("Provide exactly one of --channel, --major, or --previous-stable.");
  }
  if (options.destination === null) throw new Error("--destination is required.");
  return options;
}

function compareVersions(left, right) {
  const leftSegments = left.split(".").map(Number);
  const rightSegments = right.split(".").map(Number);
  for (let index = 0; index < Math.max(leftSegments.length, rightSegments.length); index += 1) {
    const difference = (leftSegments[index] ?? 0) - (rightSegments[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function resolvePlatform() {
  if (platform() === "linux" && arch() === "x64") return "linux64";
  if (platform() === "darwin" && arch() === "arm64") return "mac-arm64";
  if (platform() === "darwin" && arch() === "x64") return "mac-x64";
  if (platform() === "win32" && arch() === "x64") return "win64";
  throw new Error(`Unsupported Chrome for Testing platform: ${platform()} ${arch()}.`);
}

async function fetchJson(url) {
  const response = await globalThis.fetch(url, { redirect: "error" });
  if (!response.ok) throw new Error(`Unable to fetch ${url}: HTTP ${response.status}.`);
  return response.json();
}

function findChromeDownload(downloads, platformName) {
  const candidate = downloads?.chrome?.find((download) => download.platform === platformName);
  if (candidate === undefined || typeof candidate.url !== "string") {
    throw new Error(`Chrome for Testing download is unavailable for ${platformName}.`);
  }
  if (!candidate.url.startsWith(ALLOWED_DOWNLOAD_PREFIX)) {
    throw new Error(`Unexpected Chrome for Testing host: ${candidate.url}`);
  }
  return candidate.url;
}

async function resolveMajorDownload(major, platformName) {
  const payload = await fetchJson(KNOWN_GOOD_URL);
  const prefix = `${major}.`;
  const candidates = (payload.versions ?? [])
    .filter((candidate) => candidate.version?.startsWith(prefix))
    .sort((left, right) => compareVersions(right.version, left.version));
  const entry = candidates.find((candidate) =>
    candidate.downloads?.chrome?.some((download) => download.platform === platformName),
  );
  if (entry === undefined) throw new Error(`No Chrome for Testing build found for major ${major}.`);
  return { version: entry.version, url: findChromeDownload(entry.downloads, platformName) };
}

async function resolveDownload(options, platformName) {
  if (options.previousStable) {
    const channels = await fetchJson(LAST_KNOWN_GOOD_URL);
    const stable = Object.values(channels.channels ?? {}).find(
      (candidate) => candidate.channel?.toLowerCase() === "stable",
    );
    if (stable === undefined) throw new Error("Stable Chrome channel metadata is unavailable.");
    const stableMajor = Number(stable.version.split(".")[0]);
    if (!Number.isInteger(stableMajor) || stableMajor <= 1) {
      throw new Error(`Invalid stable Chrome version: ${stable.version}.`);
    }
    return resolveMajorDownload(stableMajor - 1, platformName);
  }

  if (options.channel !== null) {
    const payload = await fetchJson(LAST_KNOWN_GOOD_URL);
    const normalizedChannel = options.channel.toLowerCase();
    const entry = Object.values(payload.channels ?? {}).find(
      (candidate) => candidate.channel?.toLowerCase() === normalizedChannel,
    );
    if (entry === undefined) throw new Error(`Unknown Chrome channel: ${options.channel}.`);
    return { version: entry.version, url: findChromeDownload(entry.downloads, platformName) };
  }

  return resolveMajorDownload(options.major, platformName);
}

function run(command, arguments_) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else
        reject(
          new Error(`${command} failed with code ${code ?? "null"}, signal ${signal ?? "none"}.`),
        );
    });
  });
}

function executableRelativePath(platformName) {
  if (platformName === "linux64") return "chrome-linux64/chrome";
  if (platformName === "mac-arm64") {
    return "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
  }
  if (platformName === "mac-x64") {
    return "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
  }
  if (platformName === "win64") return "chrome-win64/chrome.exe";
  throw new Error(`Unsupported executable platform: ${platformName}.`);
}

const options = parseArguments(argv.slice(2));
const platformName = resolvePlatform();
const resolvedDownload = await resolveDownload(options, platformName);
const destination = resolve(options.destination);
const temporaryArchive = resolve(
  tmpdir(),
  `webcap-${basename(destination)}-${resolvedDownload.version}.zip`,
);
const response = await globalThis.fetch(resolvedDownload.url, { redirect: "follow" });
if (!response.ok) {
  throw new Error(`Chrome for Testing download failed: HTTP ${response.status}.`);
}
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await writeFile(temporaryArchive, Buffer.from(await response.arrayBuffer()));
try {
  if (platform() === "win32") {
    await run("powershell", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath '${temporaryArchive.replaceAll("'", "''")}' -DestinationPath '${destination.replaceAll("'", "''")}' -Force`,
    ]);
  } else {
    await run("unzip", ["-q", "-o", temporaryArchive, "-d", destination]);
  }
} finally {
  await rm(temporaryArchive, { force: true });
}
const executablePath = resolve(destination, executableRelativePath(platformName));
if (platform() !== "win32") await chmod(executablePath, 0o755);

if (options.githubOutputKey !== null) {
  const outputFile = env.GITHUB_OUTPUT;
  if (outputFile === undefined) throw new Error("GITHUB_OUTPUT is not available.");
  const { appendFile } = await import("node:fs/promises");
  await appendFile(outputFile, `${options.githubOutputKey}=${executablePath}\n`, "utf8");
  await appendFile(
    outputFile,
    `${options.githubOutputKey}_version=${resolvedDownload.version}\n`,
    "utf8",
  );
}
stdout.write(
  `${JSON.stringify({
    type: "webcap-chrome-for-testing-install",
    version: resolvedDownload.version,
    platform: platformName,
    executablePath,
  })}\n`,
);
