/**
 * Event log — append-only JSONL file recording all orchestrator events.
 *
 * Format: one JSON object per line (JSONL / newline-delimited JSON).
 * Location: ~/.agent-orchestrator/{hash}-events.jsonl
 *
 * Designed to be:
 * - Best-effort: logging errors never crash the orchestrator
 * - Append-only: safe for concurrent writers (append is atomic on POSIX)
 * - Human-readable: plain JSONL, greppable with jq
 */

import { appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { EventLog, OrchestratorEvent } from "./types.js";

/** Create an event log that appends events to a JSONL file at `logPath`. */
export function createEventLog(logPath: string): EventLog {
  return {
    log(event: OrchestratorEvent): void {
      try {
        mkdirSync(dirname(logPath), { recursive: true });
        const entry = JSON.stringify({
          ...event,
          timestamp: event.timestamp.toISOString(),
        });
        appendFileSync(logPath, entry + "\n", "utf-8");
      } catch {
        // Event logging is best-effort — never crash the orchestrator
      }
    },

    readRecent(limit = 100): OrchestratorEvent[] {
      if (!existsSync(logPath)) return [];
      try {
        const content = readFileSync(logPath, "utf-8");
        const lines = content.trim().split("\n").filter(Boolean);
        const slice = limit > 0 ? lines.slice(-limit) : lines;
        return slice.flatMap((line) => {
          try {
            const parsed = JSON.parse(line) as unknown;
            const entry = parsed as OrchestratorEvent & { timestamp: string };
            return [{ ...entry, timestamp: new Date(entry.timestamp) }];
          } catch {
            return [];
          }
        });
      } catch {
        return [];
      }
    },
  };
}

/** Create a no-op event log (when logging is disabled or in tests). */
export function createNullEventLog(): EventLog {
  return {
    log(): void {},
    readRecent(): OrchestratorEvent[] {
      return [];
    },
  };
}
