import type { PdfSourceCapability } from "@shared/contracts/pdf-source";

export interface PdfPermissionRuntime {
  request(permission: chrome.permissions.Permissions): Promise<boolean>;
  isFileAccessAllowed(): Promise<boolean>;
}

const browserPermissions: PdfPermissionRuntime = {
  request: (permission) => chrome.permissions.request(permission),
  isFileAccessAllowed: () => chrome.extension.isAllowedFileSchemeAccess(),
};

export async function requestPdfSourcePermission(
  capability: PdfSourceCapability,
  runtime: PdfPermissionRuntime = browserPermissions,
): Promise<boolean> {
  if (capability.permission === "granted" || capability.permission === "not-required") {
    return true;
  }
  if (capability.permissionOrigin === undefined) return false;
  if (capability.permission === "file-access-required") {
    if (await runtime.isFileAccessAllowed()) return true;
    const granted = await runtime.request({ origins: [capability.permissionOrigin] });
    return granted && runtime.isFileAccessAllowed();
  }
  return runtime.request({ origins: [capability.permissionOrigin] });
}
