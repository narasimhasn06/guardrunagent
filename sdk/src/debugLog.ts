import * as fs from "node:fs";

import { DEBUG_LOG_FILE, ensureConfigDir } from "./config";

/**
 * Last-resort diagnostic aid, not part of the guaranteed data path --
 * that's queue.ts's job. Never throws, so a logging failure can't crash
 * a hook.
 */
export function debugLog(message: string): void {
  try {
    ensureConfigDir();
    fs.appendFileSync(DEBUG_LOG_FILE, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // intentionally swallowed
  }
}
