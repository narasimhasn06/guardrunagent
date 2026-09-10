import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Separate from vitest.config.ts deliberately: perf/*.perf.test.tsx makes
// timing assertions (docs/06-test-plan.md Section 6's Session Replay
// load-time NFR), which are exactly the kind of test that gets flaky on
// a shared/throttled CI runner. Keeping it out of the default `npm test`
// glob (tests/**/*.test.{ts,tsx}) means it never blocks a PR; run it
// explicitly with `npm run test:perf` instead.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["perf/**/*.perf.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
