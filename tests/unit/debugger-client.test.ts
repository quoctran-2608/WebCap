import type {
  ChromeDebuggerAdapter,
  DebuggerDetachEvent,
  DebuggerDetachListener,
  DebuggerTarget,
} from "@background/chrome-debugger-adapter";
import { DebuggerClient } from "@background/debugger-client";
import { WebCapRuntimeError } from "@shared/errors/error";

class FakeDebuggerAdapter implements ChromeDebuggerAdapter {
  readonly calls: string[] = [];
  readonly listeners = new Set<DebuggerDetachListener>();
  attachError: unknown;
  detachError: unknown;
  commandError: unknown;
  commandResult: unknown = { ok: true };

  async attach(target: DebuggerTarget, version: string): Promise<void> {
    this.calls.push(`attach:${target.tabId}:${version}`);
    if (this.attachError !== undefined) {
      throw this.attachError;
    }
  }

  async detach(target: DebuggerTarget): Promise<void> {
    this.calls.push(`detach:${target.tabId}`);
    if (this.detachError !== undefined) {
      throw this.detachError;
    }
  }

  async sendCommand(
    target: DebuggerTarget,
    method: string,
    _commandParams?: Record<string, unknown>,
  ): Promise<unknown> {
    this.calls.push(`command:${target.tabId}:${method}`);
    if (this.commandError !== undefined) {
      throw this.commandError;
    }
    return this.commandResult;
  }

  addDetachListener(listener: DebuggerDetachListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emitDetach(event: DebuggerDetachEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

function expectRuntimeError(error: unknown, code: string): WebCapRuntimeError {
  expect(error).toBeInstanceOf(WebCapRuntimeError);
  const runtimeError = error as WebCapRuntimeError;
  expect(runtimeError.code).toBe(code);
  return runtimeError;
}

describe("DebuggerClient", () => {
  it("attaches, sends a command, and detaches on success", async () => {
    const adapter = new FakeDebuggerAdapter();
    const client = new DebuggerClient(adapter);

    await expect(
      client.withSession(9, (session) => session.sendCommand("Page.getLayoutMetrics")),
    ).resolves.toEqual({ ok: true });

    expect(adapter.calls).toEqual([
      "attach:9:0.1",
      "command:9:Page.getLayoutMetrics",
      "detach:9",
    ]);
    expect(adapter.listeners.size).toBe(0);
  });

  it("normalizes command errors and still detaches", async () => {
    const adapter = new FakeDebuggerAdapter();
    adapter.commandError = new Error("Method failed");
    const client = new DebuggerClient(adapter);

    const error = await client
      .withSession(3, (session) => session.sendCommand("Page.getLayoutMetrics"))
      .catch((value: unknown) => value);

    expectRuntimeError(error, "E_CDP_COMMAND");
    expect(adapter.calls).toEqual([
      "attach:3:0.1",
      "command:3:Page.getLayoutMetrics",
      "detach:3",
    ]);
  });

  it("normalizes attach errors without trying to detach", async () => {
    const adapter = new FakeDebuggerAdapter();
    adapter.attachError = new Error("Another debugger is already attached");
    const client = new DebuggerClient(adapter);

    const error = await client.withSession(7, async () => undefined).catch((value: unknown) => value);

    expectRuntimeError(error, "E_DEBUGGER_ATTACH");
    expect(adapter.calls).toEqual(["attach:7:0.1"]);
  });

  it("rejects when Chrome unexpectedly detaches the owned session", async () => {
    const adapter = new FakeDebuggerAdapter();
    const client = new DebuggerClient(adapter);
    let releaseTask: (() => void) | undefined;

    const work = client.withSession(
      11,
      () =>
        new Promise<void>((resolve) => {
          releaseTask = resolve;
        }),
    );
    await vi.waitFor(() => expect(adapter.calls).toContain("attach:11:0.1"));
    adapter.emitDetach({ target: { tabId: 11 }, reason: "canceled_by_user" });

    const error = await work.catch((value: unknown) => value);
    expectRuntimeError(error, "E_DEBUGGER_DETACHED");
    expect(adapter.calls).toContain("detach:11");
    releaseTask?.();
  });

  it("rejects a second concurrent session for the same tab", async () => {
    const adapter = new FakeDebuggerAdapter();
    const client = new DebuggerClient(adapter);
    let releaseFirst: (() => void) | undefined;

    const first = client.withSession(
      5,
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    await vi.waitFor(() => expect(adapter.calls).toContain("attach:5:0.1"));

    const error = await client.withSession(5, async () => undefined).catch((value: unknown) => value);
    expectRuntimeError(error, "E_DEBUGGER_ATTACH");

    releaseFirst?.();
    await first;
  });

  it("surfaces a real detach cleanup failure", async () => {
    const adapter = new FakeDebuggerAdapter();
    adapter.detachError = new Error("Detach transport failed");
    const client = new DebuggerClient(adapter);

    const error = await client.withSession(2, async () => "done").catch((value: unknown) => value);
    expectRuntimeError(error, "E_CLEANUP_PARTIAL");
  });

  it("ignores the already-detached cleanup error", async () => {
    const adapter = new FakeDebuggerAdapter();
    adapter.detachError = new Error("Debugger is not attached to the tab");
    const client = new DebuggerClient(adapter);

    await expect(client.withSession(2, async () => "done")).resolves.toBe("done");
  });
});
