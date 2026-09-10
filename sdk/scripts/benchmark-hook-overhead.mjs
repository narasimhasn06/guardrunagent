#!/usr/bin/env node
// docs/06-test-plan.md Section 6: "SDK overhead per tool call | Under
// 50ms added latency | Benchmark tool-call execution time with and
// without the SDK hook active."
//
// There's no persistent SDK process and no real Claude Code session to
// run "with vs. without the hook" inside -- per CLAUDE.md's "SDK hooks
// are one-shot processes" decision, Claude Code spawns
// dist/hooks/preToolUse.js fresh for every tool call and waits for it to
// exit before proceeding. That spawn-to-exit wall time *is* the overhead
// this NFR is about, so that's what this script measures directly,
// rather than trying to simulate "without the hook" (which is just 0ms
// by definition once you're spawning a real process).
//
// Measures the fast path only (a harmless command that matches no cached
// rule, so no /guardrail-check network round-trip happens) -- that's the
// overwhelmingly common case in a real session and the one this NFR is
// really about; a rule-matching action's added network latency is
// covered separately by the guardrail-check load test
// (backend/scripts/load_test_guardrail_check.py).
//
// Usage: npm run build && node scripts/benchmark-hook-overhead.mjs [n]

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const SDK_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HOOK_PATH = path.join(SDK_ROOT, "dist", "hooks", "preToolUse.js");
const TARGET_MS = 50;
const ITERATIONS = Number(process.argv[2]) || 50;

if (!fs.existsSync(HOOK_PATH)) {
  console.error(`Not built: ${HOOK_PATH} doesn't exist. Run "npm run build" first.`);
  process.exit(1);
}

function setUpIsolatedHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "guardrunagent-benchmark-home-"));
  const configDir = path.join(home, ".guardrunagent");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "config.json"),
    JSON.stringify({ apiKey: "benchmark-key", endpoint: "http://127.0.0.1:1" }) // never actually called
  );
  // A fresh rule cache (matches the steady-state case during an active
  // session -- see ruleCache.ts's 5-minute refresh window) so the hook
  // never attempts a real GET /rules network call during the benchmark.
  fs.writeFileSync(
    path.join(configDir, "rules-cache.json"),
    JSON.stringify({
      fetchedAt: Date.now(),
      rules: [
        {
          id: "r1",
          name: "no-force-push-main",
          pattern_type: "command_regex",
          pattern_value: "^git push --force",
          action_on_match: "block",
          enabled: true,
        },
        {
          id: "r2",
          name: "no-rm-rf",
          pattern_type: "command_regex",
          pattern_value: "rm -rf",
          action_on_match: "block",
          enabled: true,
        },
      ],
    })
  );
  return home;
}

function runOnce(home) {
  return new Promise((resolve, reject) => {
    const input = JSON.stringify({
      session_id: "benchmark-session",
      tool_name: "Bash",
      tool_input: { command: "npm install" }, // harmless -- fast path, no rule match
    });

    const start = process.hrtime.bigint();
    const child = spawn(process.execPath, [HOOK_PATH], {
      env: { ...process.env, HOME: home },
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.on("error", reject);
    child.on("exit", () => {
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
      resolve(elapsedMs);
    });
    child.stdin.end(input);
  });
}

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  const home = setUpIsolatedHome();
  const timings = [];

  // One untimed warm-up run -- the OS's disk cache for node_modules/dist
  // being cold on the very first spawn isn't representative of a real
  // session, where Claude Code has already spawned this process before.
  await runOnce(home);

  for (let i = 0; i < ITERATIONS; i++) {
    timings.push(await runOnce(home));
  }

  fs.rmSync(home, { recursive: true, force: true });

  const sorted = [...timings].sort((a, b) => a - b);
  const mean = timings.reduce((a, b) => a + b, 0) / timings.length;
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);

  console.log(`PreToolUse hook overhead, fast path, n=${ITERATIONS}`);
  console.log(`  min:  ${sorted[0].toFixed(1)}ms`);
  console.log(`  mean: ${mean.toFixed(1)}ms`);
  console.log(`  p50:  ${p50.toFixed(1)}ms`);
  console.log(`  p95:  ${p95.toFixed(1)}ms`);
  console.log(`  p99:  ${p99.toFixed(1)}ms`);
  console.log(`  max:  ${sorted[sorted.length - 1].toFixed(1)}ms`);
  console.log(`Target: p99 < ${TARGET_MS}ms`);

  if (p99 >= TARGET_MS) {
    console.log(
      `FAIL -- p99 (${p99.toFixed(1)}ms) is at or above target. Note: on most machines this is dominated by ` +
        `Node.js process startup itself, not GuardrunAgent's own code -- if that's the case here too, the fix ` +
        `is a lighter startup path (e.g. avoiding heavy imports in the hook entrypoint), not this benchmark.`
    );
    process.exitCode = 1;
  } else {
    console.log("PASS");
  }
}

main();
