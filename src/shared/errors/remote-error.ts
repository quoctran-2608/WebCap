import type { WebCapErrorData } from "@shared/errors/error";
import { createWebCapRuntimeError } from "@shared/errors/error";

export function throwRemoteWebCapError(payload: WebCapErrorData): never {
  throw createWebCapRuntimeError(payload);
}
