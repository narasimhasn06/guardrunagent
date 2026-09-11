import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GuardrunAgentConfig } from "../src/config";
import { enqueueAndMaybeFlush, flushAll, maybeFlush, type QueuePaths, type QueuedEvent } from "../src/queue";

/**
 * docs/06-test-plan.md Section 6, "Event ingestion durability": "Kill the
 * backend mid-session, verify all buffered events are recovered and sent
 * once the backend returns." tests/queue.test.ts already covers the
 * retry/fallback-file/recovery *logic* thoroughly, but against a mocked
 * `fetch` -- every failure there is a rejected/resolved Promise the test
 * controls directly. This file runs the same recovery path against a
 * real local HTTP server that actually gets shut down and restarted, so
 * the real failure mode (a genuine ECONNREFUSED from `fetch`, not a
 * mocked one) is what's exercised. No Supabase/real backend is needed --
 * queue.ts's only contract with "the backend" is POST /events returning
 * ok/not-ok, which a plain http.Server can stand in for.
 */

let tmpDir: string;
let paths: QueuePaths;
let port: number;
let server: http.Server;
let receivedBatches: QueuedEvent[][];

function makeEvent(actionSummary: string): QueuedEvent {
  return {
    action_type: "bash",
    action_summary: actionSummary,
    status: "success",
    timestamp: new Date().toISOString(),
  };
}

function startServer(): Promise<void> {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      receivedBatches.push(body.events);
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ received: body.events.length }));
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve()));
}

function stopServer(): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function config(): GuardrunAgentConfig {
  return { apiKey: "test-key", endpoint: `http://127.0.0.1:${port}`, failModeOverride: undefined };
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guardrunagent-durability-test-"));
  paths = {
    queueDir: path.join(tmpDir, "queue"),
    failedEventsFile: path.join(tmpDir, "failed_events.jsonl"),
  };
  receivedBatches = [];

  // Bind once to claim a free ephemeral port, then close and reopen on
  // that same fixed port -- the "backend comes back" step below needs a
  // stable port to restart on.
  const probe = http.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));

  await startServer();
});

afterEach(async () => {
  await stopServer().catch(() => undefined);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("event ingestion survives a real backend outage", () => {
  it("delivers events normally while the backend is up", async () => {
    await enqueueAndMaybeFlush("session-1", makeEvent("npm install"), config(), paths);
    await flushAll("session-1", config(), paths);

    expect(receivedBatches).toHaveLength(1);
    expect(receivedBatches[0]).toHaveLength(1);
  });

  it("falls back to the local file when the backend is unreachable, then recovers everything once it returns", async () => {
    // Backend is up: one event goes through immediately.
    await enqueueAndMaybeFlush("session-1", makeEvent("git status"), config(), paths);
    await flushAll("session-1", config(), paths);
    expect(receivedBatches.flat()).toHaveLength(1);

    // Backend goes down mid-session.
    await stopServer();

    // Three more events are produced while it's down -- queued locally,
    // and a forced flush attempt genuinely fails (real ECONNREFUSED, not
    // a mock) and falls back to the local file rather than being dropped.
    await enqueueAndMaybeFlush("session-1", makeEvent("git commit"), config(), paths);
    await enqueueAndMaybeFlush("session-1", makeEvent("git push"), config(), paths);
    await enqueueAndMaybeFlush("session-1", makeEvent("npm test"), config(), paths);
    await flushAll("session-1", config(), paths);

    expect(fs.existsSync(paths.failedEventsFile)).toBe(true);
    const failedCount = fs.readFileSync(paths.failedEventsFile, "utf8").split("\n").filter(Boolean).length;
    expect(failedCount).toBe(3);
    expect(receivedBatches.flat()).toHaveLength(1); // still just the pre-outage event

    // Backend returns.
    await startServer();

    // The next flush opportunity (any hook invocation calls maybeFlush,
    // which retries the fallback file first) recovers the stranded batch.
    await maybeFlush("session-1", config(), paths);

    expect(fs.existsSync(paths.failedEventsFile)).toBe(false);
    const allDeliveredSummaries = receivedBatches
      .flat()
      .map((event) => event.action_summary)
      .sort();
    expect(allDeliveredSummaries).toEqual(["git commit", "git push", "git status", "npm test"].sort());
  });
});
