import * as crypto from "node:crypto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Fixed namespace UUID for deterministically deriving a UUID from Claude
// Code's own session_id when it isn't already UUID-shaped. Claude Code's
// documented examples show opaque strings like "abc123" -- not confirmed
// to always be UUIDs -- but the backend's `sessions.id` is a Postgres
// `uuid` column (docs/03-low-level-design.md Section 1), so a non-UUID
// session_id would fail the insert outright without this.
const NAMESPACE = "6f1f9b0a-2c1e-4a4d-9a9e-6c9b7a2f5e10";

/**
 * Maps an arbitrary Claude Code session_id to a UUID suitable for
 * sessions.id, deterministically -- the same input always produces the
 * same output, so repeated hook calls within one Claude Code session all
 * resolve to the same backend session row.
 */
export function deriveSessionUuid(rawSessionId: string): string {
  if (UUID_RE.test(rawSessionId)) {
    return rawSessionId.toLowerCase();
  }
  return uuidV5(rawSessionId, NAMESPACE);
}

/** RFC 4122 UUID v5 (SHA-1 based), implemented directly to avoid adding a
 * dependency for one small, well-specified algorithm. */
function uuidV5(name: string, namespace: string): string {
  const namespaceBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const nameBytes = Buffer.from(name, "utf8");
  const hash = crypto
    .createHash("sha1")
    .update(Buffer.concat([namespaceBytes, nameBytes]))
    .digest();

  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
