import * as fs from "node:fs";
import * as path from "node:path";

import type { GuardrunAgentConfig } from "./config";
import { debugLog } from "./debugLog";
import { postJson } from "./httpClient";

export interface QueuedEvent {
  action_type: string;
  action_summary?: string;
  payload_meta?: Record<string, unknown>;
  reasoning_snippet?: string;
  tokens_used?: number;
  cost_usd?: string;
  status: "success" | "failure" | "blocked" | "flagged";
  timestamp: string;
}

export interface QueuePaths {
  queueDir: string;
  failedEventsFile: string;
}

interface QueueLine {
  enqueuedAt: number;
  event: QueuedEvent;
}

const BATCH_SIZE = 50; // docs/03-low-level-design.md Section 3.3
const FLUSH_AGE_MS = 2000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 200;

function queueFilePath(paths: QueuePaths, sessionId: string): string {
  return path.join(paths.queueDir, `${sessionId}.jsonl`);
}

/**
 * Appends one event to this session's on-disk queue and, if the queue has
 * grown past the batch size or its oldest entry is old enough, attempts a
 * flush.
 *
 * ADAPTATION FROM THE LLD: Section 3.3 describes an in-memory queue
 * flushed "in batches of up to 50 or every 2 seconds, whichever first" --
 * that assumes a persistent SDK process holding a timer. Claude Code's
 * real hook model spawns a fresh process per hook invocation (verified
 * against https://code.claude.com/docs/en/hooks.md), so there's no
 * process alive between tool calls to hold either the buffer or the
 * timer. This file-backed queue plus an opportunistic flush on every
 * invocation is the closest equivalent: during an active session, tool
 * calls happen often enough that this behaves close to the documented
 * cadence; during an idle stretch, queued events can sit until the next
 * tool call or SessionEnd's final flush. This is an approximation of a
 * design written for a persistent process, not a literal implementation
 * of it -- flagged for review.
 */
export async function enqueueAndMaybeFlush(
  sessionId: string,
  event: QueuedEvent,
  config: GuardrunAgentConfig,
  paths: QueuePaths
): Promise<void> {
  fs.mkdirSync(paths.queueDir, { recursive: true });
  const filePath = queueFilePath(paths, sessionId);
  const line: QueueLine = { enqueuedAt: Date.now(), event };
  fs.appendFileSync(filePath, JSON.stringify(line) + "\n");

  await maybeFlush(sessionId, config, paths);
}

export async function maybeFlush(sessionId: string, config: GuardrunAgentConfig, paths: QueuePaths): Promise<void> {
  await retryFailedEvents(config, paths);

  const filePath = queueFilePath(paths, sessionId);
  const lines = readQueueLines(filePath);
  if (lines.length === 0) return;

  const oldestAgeMs = Date.now() - lines[0].enqueuedAt;
  const shouldFlush = lines.length >= BATCH_SIZE || oldestAgeMs >= FLUSH_AGE_MS;
  if (!shouldFlush) return;

  await flushBatch(sessionId, lines, config, paths);
}

/**
 * Force-flushes every remaining event for a session, ignoring the
 * batch-size/age thresholds. Used by SessionEnd, which gets one last
 * chance to drain the queue before the session's process tree goes away.
 */
export async function flushAll(sessionId: string, config: GuardrunAgentConfig, paths: QueuePaths): Promise<void> {
  await retryFailedEvents(config, paths);
  const filePath = queueFilePath(paths, sessionId);
  const lines = readQueueLines(filePath);
  if (lines.length > 0) {
    await flushBatch(sessionId, lines, config, paths, /* forceAll */ true);
  }
}

async function flushBatch(
  sessionId: string,
  lines: QueueLine[],
  config: GuardrunAgentConfig,
  paths: QueuePaths,
  forceAll = false
): Promise<void> {
  const filePath = queueFilePath(paths, sessionId);
  let remaining = lines;

  while (remaining.length > 0) {
    const batch = remaining.slice(0, BATCH_SIZE);
    const rest = remaining.slice(BATCH_SIZE);

    const sent = await sendBatchWithRetry(
      config,
      sessionId,
      batch.map((l) => l.event)
    );
    if (!sent) {
      appendFailedEvents(
        paths,
        sessionId,
        batch.map((l) => l.event)
      );
    }

    writeQueueLines(filePath, rest);
    remaining = rest;

    if (!forceAll) break; // only drain one batch per opportunistic flush
  }
}

async function sendBatchWithRetry(
  config: GuardrunAgentConfig,
  sessionId: string,
  events: QueuedEvent[]
): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await postJson(config, "/events", { session_id: sessionId, events });
      if (response.ok) return true;
      debugLog(`POST /events returned ${response.status}, attempt ${attempt + 1}/${MAX_RETRIES}`);
    } catch (err) {
      debugLog(`POST /events failed, attempt ${attempt + 1}/${MAX_RETRIES}: ${String(err)}`);
    }
    if (attempt < MAX_RETRIES - 1) {
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
    }
  }
  return false;
}

interface FailedEntry {
  sessionId: string;
  event: QueuedEvent;
}

function appendFailedEvents(paths: QueuePaths, sessionId: string, events: QueuedEvent[]): void {
  try {
    fs.mkdirSync(path.dirname(paths.failedEventsFile), { recursive: true });
    const lines = events.map((event) => JSON.stringify({ sessionId, event } satisfies FailedEntry) + "\n").join("");
    fs.appendFileSync(paths.failedEventsFile, lines);
  } catch (err) {
    debugLog(`failed to persist events to fallback file: ${String(err)}`);
  }
}

/**
 * Retries events previously written to the fallback file after exhausting
 * MAX_RETRIES. There's no "on SDK init" moment in the one-shot-process
 * model (Section 3.3's literal wording), so this runs at the start of
 * every flush attempt instead -- the closest available equivalent.
 */
async function retryFailedEvents(config: GuardrunAgentConfig, paths: QueuePaths): Promise<void> {
  let entries: FailedEntry[];
  try {
    const raw = fs.readFileSync(paths.failedEventsFile, "utf8");
    entries = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as FailedEntry);
  } catch {
    return; // no fallback file yet
  }
  if (entries.length === 0) return;

  const bySession = new Map<string, QueuedEvent[]>();
  for (const { sessionId, event } of entries) {
    const list = bySession.get(sessionId) ?? [];
    list.push(event);
    bySession.set(sessionId, list);
  }

  const stillFailed: FailedEntry[] = [];
  for (const [sessionId, events] of bySession) {
    const sent = await sendBatchWithRetry(config, sessionId, events);
    if (!sent) {
      for (const event of events) stillFailed.push({ sessionId, event });
    }
  }

  try {
    if (stillFailed.length === 0) {
      fs.rmSync(paths.failedEventsFile, { force: true });
    } else {
      fs.writeFileSync(paths.failedEventsFile, stillFailed.map((e) => JSON.stringify(e) + "\n").join(""));
    }
  } catch (err) {
    debugLog(`failed to rewrite fallback file after retry: ${String(err)}`);
  }
}

function readQueueLines(filePath: string): QueueLine[] {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as QueueLine);
  } catch {
    return [];
  }
}

function writeQueueLines(filePath: string, lines: QueueLine[]): void {
  try {
    if (lines.length === 0) {
      fs.rmSync(filePath, { force: true });
    } else {
      fs.writeFileSync(filePath, lines.map((l) => JSON.stringify(l) + "\n").join(""));
    }
  } catch (err) {
    debugLog(`failed to rewrite queue file ${filePath}: ${String(err)}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
