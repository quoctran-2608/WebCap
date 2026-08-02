import type { TabCapabilityPayload } from "@shared/contracts/messages";
import { createWebCapError, type WebCapErrorData } from "@shared/errors/error";
import { normalizeError } from "@shared/errors/normalize-error";
import { err, ok, type Result } from "@shared/result";

import type { ActiveTabSnapshot, TabsCaptureAdapter } from "./chrome-tabs-adapter";

const SUPPORTED_SCHEMES = new Set(["http", "https", "file"]);

export interface CapturableTabContext {
  tabId: number;
  windowId: number;
  scheme: string;
}

function schemeOf(url: string | undefined): string | undefined {
  if (url === undefined) {
    return undefined;
  }

  try {
    return new URL(url).protocol.replace(/:$/, "").toLowerCase();
  } catch {
    return undefined;
  }
}

function unavailableCapability(errorCode: WebCapErrorData["code"]): TabCapabilityPayload {
  return { status: "unavailable", errorCode };
}

export function evaluateTab(tab: ActiveTabSnapshot | undefined): TabCapabilityPayload {
  if (tab === undefined || !tab.active) {
    return unavailableCapability("E_TAB_NOT_ACTIVE");
  }

  const scheme = schemeOf(tab.url);
  if (scheme === undefined || !SUPPORTED_SCHEMES.has(scheme)) {
    return {
      status: "unsupported",
      tabId: tab.id,
      windowId: tab.windowId,
      ...(scheme === undefined ? {} : { scheme }),
      errorCode: "E_UNSUPPORTED_URL",
    };
  }

  return {
    status: "supported",
    tabId: tab.id,
    windowId: tab.windowId,
    scheme,
  };
}

export async function inspectActiveTab(adapter: TabsCaptureAdapter): Promise<TabCapabilityPayload> {
  try {
    return evaluateTab(await adapter.queryActiveTab());
  } catch (error) {
    const normalized = normalizeError(error, {
      code: "E_PERMISSION_DENIED",
      stage: "permission",
      userMessageKey: "errors.permissionDenied",
      retryable: true,
      fallbackAllowed: false,
    });
    return unavailableCapability(normalized.code);
  }
}

export async function requireCapturableTab(
  adapter: TabsCaptureAdapter,
): Promise<Result<CapturableTabContext, WebCapErrorData>> {
  let tab: ActiveTabSnapshot | undefined;
  try {
    tab = await adapter.queryActiveTab();
  } catch (error) {
    return err(
      normalizeError(error, {
        code: "E_PERMISSION_DENIED",
        stage: "permission",
        userMessageKey: "errors.permissionDenied",
        retryable: true,
        fallbackAllowed: false,
      }),
    );
  }

  const capability = evaluateTab(tab);
  if (
    capability.status === "supported" &&
    capability.tabId !== undefined &&
    capability.windowId !== undefined &&
    capability.scheme !== undefined
  ) {
    return ok({
      tabId: capability.tabId,
      windowId: capability.windowId,
      scheme: capability.scheme,
    });
  }

  const unsupported = capability.status === "unsupported";
  return err(
    createWebCapError({
      code: unsupported ? "E_UNSUPPORTED_URL" : "E_TAB_NOT_ACTIVE",
      stage: unsupported ? "permission" : "prepare",
      message: unsupported
        ? "The active tab URL is not supported for capture."
        : "No active capturable tab is available.",
      userMessageKey: unsupported ? "errors.unsupportedUrl" : "errors.tabNotActive",
      retryable: !unsupported,
      fallbackAllowed: false,
      ...(capability.scheme === undefined ? {} : { safeContext: { scheme: capability.scheme } }),
    }),
  );
}
