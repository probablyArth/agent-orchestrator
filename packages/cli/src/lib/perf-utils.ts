/**
 * Shared helpers for performance analysis commands.
 * Used by `ao perf` and potentially other CLI commands that read API logs.
 */

import { loadConfig, resolveProjectLogDir, readLogsFromDir } from "@composio/ao-core";

export interface ParsedRequest {
  ts: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  error?: string;
  timings?: Record<string, number>;
  cacheStats?: { hits: number; misses: number; hitRate: number; size: number };
}

/** Resolve the log directory from config. Throws if no projects configured. */
export function resolveLogDir(): string {
  const config = loadConfig();
  const dir = resolveProjectLogDir(config);
  if (!dir) throw new Error("No projects configured. Run `ao init` first.");
  return dir;
}

/** Parse API log entries into typed request objects. */
export function loadRequests(logDir: string, opts?: { since?: Date; route?: string }): ParsedRequest[] {
  const entries = readLogsFromDir(logDir, "api", {
    source: "api",
    since: opts?.since,
  });

  const requests: ParsedRequest[] = [];
  for (const entry of entries) {
    const data = entry.data ?? {};
    if (!data["method"] || !data["path"]) continue;

    const req: ParsedRequest = {
      ts: entry.ts,
      method: String(data["method"]),
      path: String(data["path"]),
      statusCode: Number(data["statusCode"]) || 0,
      durationMs: Number(data["durationMs"]) || 0,
      error: data["error"] ? String(data["error"]) : undefined,
      timings: data["timings"] as Record<string, number> | undefined,
      cacheStats: data["cacheStats"] as ParsedRequest["cacheStats"] | undefined,
    };

    if (opts?.route && !req.path.includes(opts.route)) continue;
    requests.push(req);
  }

  return requests;
}
