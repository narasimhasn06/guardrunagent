import { describe, expect, it } from "vitest";

import { deriveSessionUuid } from "../src/sessionId";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("deriveSessionUuid", () => {
  it("passes an already-UUID session_id through unchanged (lowercased)", () => {
    const uuid = "550E8400-E29B-41D4-A716-446655440000";
    expect(deriveSessionUuid(uuid)).toBe(uuid.toLowerCase());
  });

  it("derives a stable UUID from a non-UUID session_id", () => {
    const result = deriveSessionUuid("abc123");
    expect(result).toMatch(UUID_RE);
  });

  it("is deterministic -- the same input always maps to the same UUID", () => {
    expect(deriveSessionUuid("abc123")).toBe(deriveSessionUuid("abc123"));
  });

  it("produces different UUIDs for different session ids", () => {
    expect(deriveSessionUuid("session-one")).not.toBe(deriveSessionUuid("session-two"));
  });
});
