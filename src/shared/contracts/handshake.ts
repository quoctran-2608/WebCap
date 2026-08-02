export const PROTOCOL_VERSION = 1 as const;

export type HandshakeSource = "popup" | "background";

export interface Envelope<
  TType extends string,
  TPayload,
  TSource extends HandshakeSource,
  TTarget extends HandshakeSource,
> {
  protocolVersion: typeof PROTOCOL_VERSION;
  requestId: string;
  source: TSource;
  target: TTarget;
  type: TType;
  payload: TPayload;
  sentAt: string;
}

export type PingMessage = Envelope<
  "PING",
  {
    client: "webcap-popup";
    clientVersion: string;
  },
  "popup",
  "background"
>;

export type PongMessage = Envelope<
  "PONG",
  {
    worker: "webcap-service-worker";
    workerVersion: string;
    requestSentAt: string;
  },
  "background",
  "popup"
>;

interface PingMessageOptions {
  requestId: string;
  clientVersion: string;
  sentAt: string;
}

interface PongMessageOptions {
  requestId: string;
  workerVersion: string;
  requestSentAt: string;
  sentAt: string;
}

export function createPingMessage(options: PingMessageOptions): PingMessage {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "popup",
    target: "background",
    type: "PING",
    payload: {
      client: "webcap-popup",
      clientVersion: options.clientVersion,
    },
    sentAt: options.sentAt,
  };
}

export function createPongMessage(options: PongMessageOptions): PongMessage {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "popup",
    type: "PONG",
    payload: {
      worker: "webcap-service-worker",
      workerVersion: options.workerVersion,
      requestSentAt: options.requestSentAt,
    },
    sentAt: options.sentAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasString(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === "string";
}

export function isPingMessage(value: unknown): value is PingMessage {
  if (!isRecord(value) || !isRecord(value.payload)) {
    return false;
  }

  return (
    value.protocolVersion === PROTOCOL_VERSION &&
    value.type === "PING" &&
    value.source === "popup" &&
    value.target === "background" &&
    hasString(value, "requestId") &&
    hasString(value, "sentAt") &&
    value.payload.client === "webcap-popup" &&
    typeof value.payload.clientVersion === "string"
  );
}

export function isPongMessage(value: unknown): value is PongMessage {
  if (!isRecord(value) || !isRecord(value.payload)) {
    return false;
  }

  return (
    value.protocolVersion === PROTOCOL_VERSION &&
    value.type === "PONG" &&
    value.source === "background" &&
    value.target === "popup" &&
    hasString(value, "requestId") &&
    hasString(value, "sentAt") &&
    value.payload.worker === "webcap-service-worker" &&
    typeof value.payload.workerVersion === "string" &&
    typeof value.payload.requestSentAt === "string"
  );
}
