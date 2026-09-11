import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GuardrunAgentConfig } from "../src/config";
import { enqueueAndMaybeFlush, flushAll, type QueuePaths, type QueuedEvent } from "../src/queue";

const CONFIG: GuardrunAgentConfig = {
  apiKey: "test-key",
  endpoint: "https://backend.example",
  failModeOverride: undefined,
};

function makeEvent(overrides: Partial<QueuedEvent> = {}): QueuedEvent {
  return {
    action_type: "bash",
    action_summary: "npm install",
    status: "success",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

let tmpDir: string;
let paths: QueuePaths;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guardrunagent-queue-test-"));
  paths = {
    queueDir: path.join(tmpDir, "queue"),
    failedEventsFile: path.join(tmpDir, "failed_events.jsonl"),
  };
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function okResponse(): Response {
  return { ok: true, status: 202 } as Response;
}

function errorResponse(status = 500): Response {
  return { ok: false, status } as Response;
}

function queueFileLineCount(sessionId: string): number {
  const filePath = path.join(paths.queueDir, `${sessionId}.jsonl`);
  if (!fs.existsSync(filePath)) return 0;
  return fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean).length;
}

describe("enqueueAndMaybeFlush", () => {
  it("does not flush below the batch size and flush-age threshold", async () => {
    fetchMock.mockResolvedValue(okResponse());
    await enqueueAndMaybeFlush("session-1", makeEvent(), CONFIG, paths);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(queueFileLineCount("session-1")).toBe(1);
  });

  it("flushes once the queue reaches the batch size of 50", async () => {
    fetchMock.mockResolvedValue(okResponse());

    for (let i = 0; i < 49; i++) {
      await enqueueAndMaybeFlush("session-1", makeEvent(), CONFIG, paths);
    }
    expect(fetchMock).not.toHaveBeenCalled();

    await enqueueAndMaybeFlush("session-1", makeEvent(), CONFIG, paths); // 50th event
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body as string);
    expect(body.events).toHaveLength(50);
    expect(queueFileLineCount("session-1")).toBe(0);
  });

  it("flushes once the oldest queued event is at least 2 seconds old", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(okResponse());

    await enqueueAndMaybeFlush("session-1", makeEvent(), CONFIG, paths);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2001);
    await enqueueAndMaybeFlush("session-1", makeEvent(), CONFIG, paths);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("retries a failed send up to 3 attempts before giving up on that batch", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockResolvedValue(errorResponse());

    const flushPromise = (async () => {
      for (let i = 0; i < 50; i++) {
        await enqueueAndMaybeFlush("session-1", makeEvent(), CONFIG, paths);
      }
    })();

    await vi.runAllTimersAsync();
    await flushPromise;

    expect(fetchMock).toHaveBeenCalledTimes(3); // MAX_RETRIES
    vi.useRealTimers();
  });

  it("falls back to the local failed-events file after exhausting retries", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockResolvedValue(errorResponse());

    const flushPromise = (async () => {
      for (let i = 0; i < 50; i++) {
        await enqueueAndMaybeFlush("session-1", makeEvent(), CONFIG, paths);
      }
    })();
    await vi.runAllTimersAsync();
    await flushPromise;
    vi.useRealTimers();

    expect(fs.existsSync(paths.failedEventsFile)).toBe(true);
    const failedLines = fs.readFileSync(paths.failedEventsFile, "utf8").split("\n").filter(Boolean);
    expect(failedLines).toHaveLength(50);
    // The batch is cleared from the live queue either way -- it's been
    // durably persisted to the fallback file instead of lost.
    expect(queueFileLineCount("session-1")).toBe(0);
  });

  it("a batch survives a single failed send and is retried successfully", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock
      .mockResolvedValueOnce(errorResponse()) // 1st attempt fails
      .mockResolvedValue(okResponse()); // 2nd attempt (retry) succeeds

    const flushPromise = (async () => {
      for (let i = 0; i < 50; i++) {
        await enqueueAndMaybeFlush("session-1", makeEvent(), CONFIG, paths);
      }
    })();
    await vi.runAllTimersAsync();
    await flushPromise;
    vi.useRealTimers();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(paths.failedEventsFile)).toBe(false);
  });

  it("retries previously failed events on the next flush opportunity", async () => {
    // Pre-seed a failed-events file, as if a prior process's flush had
    // exhausted its retries and given up.
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      paths.failedEventsFile,
      JSON.stringify({ sessionId: "session-old", event: makeEvent() }) + "\n"
    );

    fetchMock.mockResolvedValue(okResponse());
    await enqueueAndMaybeFlush("session-new", makeEvent(), CONFIG, paths);

    // enqueueAndMaybeFlush's own batch (1 event, below threshold) isn't
    // sent, but the previously-failed event's retry attempt is.
    const sentSessionIds = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body).session_id);
    expect(sentSessionIds).toContain("session-old");
    expect(fs.existsSync(paths.failedEventsFile)).toBe(false);
  });
});

describe("flushAll", () => {
  it("drains every queued event regardless of batch size, in a single call", async () => {
    fetchMock.mockResolvedValue(okResponse());
    for (let i = 0; i < 5; i++) {
      await enqueueAndMaybeFlush("session-1", makeEvent(), CONFIG, paths);
    }
    expect(fetchMock).not.toHaveBeenCalled(); // below threshold, nothing flushed yet

    await flushAll("session-1", CONFIG, paths);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.events).toHaveLength(5);
    expect(queueFileLineCount("session-1")).toBe(0);
  });

  it("does nothing when the queue is empty", async () => {
    await flushAll("session-empty", CONFIG, paths);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
