import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock fns ────────────────────────────────────────────────────────────

const mockReadLogsFromDir = vi.fn();
const mockTailLogs = vi.fn();
const mockResolveProjectLogDir = vi.fn();
const mockLoadConfig = vi.fn();
const mockLogWriterAppend = vi.fn();

vi.mock("@composio/ao-core", () => ({
  resolveProjectLogDir: (...args: unknown[]) => mockResolveProjectLogDir(...args),
  readLogsFromDir: (...args: unknown[]) => mockReadLogsFromDir(...args),
  tailLogs: (...args: unknown[]) => mockTailLogs(...args),
  loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
  percentile: (sorted: number[], p: number) => {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  },
  normalizeRoutePath: (path: string) =>
    path
      .replace(/\/sessions\/[^/]+/g, "/sessions/:id")
      .replace(/\/prs\/[^/]+/g, "/prs/:id"),
  LogWriter: vi.fn().mockImplementation(() => ({
    append: mockLogWriterAppend,
    appendLine: vi.fn(),
    close: vi.fn(),
  })),
}));

// ── Import routes after mocking ─────────────────────────────────────────

const { GET: logsGET } = await import("../app/api/logs/route.js");
const { GET: perfGET } = await import("../app/api/perf/route.js");
const { POST: clientLogsPost } = await import("../app/api/client-logs/route.js");

// ── Helpers ─────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadConfig.mockReturnValue({});
  mockResolveProjectLogDir.mockReturnValue("/tmp/test-logs");
});

// ── GET /api/logs ───────────────────────────────────────────────────────

describe("GET /api/logs", () => {
  it("returns entries when logs exist", async () => {
    const fakeEntries = [
      {
        ts: "2026-01-01T00:00:00Z",
        level: "info",
        source: "events",
        sessionId: null,
        message: "session spawned",
      },
      {
        ts: "2026-01-01T00:01:00Z",
        level: "warn",
        source: "events",
        sessionId: "s-1",
        message: "timeout",
      },
    ];
    mockReadLogsFromDir.mockReturnValue(fakeEntries);

    const req = new Request("http://localhost:3000/api/logs?limit=100");
    const res = await logsGET(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.entries).toHaveLength(2);
    expect(json.count).toBe(2);
    expect(json.entries[0].message).toBe("session spawned");
  });

  it("applies source filter (maps to file prefix)", async () => {
    mockReadLogsFromDir.mockReturnValue([]);

    const req = new Request("http://localhost:3000/api/logs?source=api&limit=50");
    await logsGET(req);

    // readLogsFromDir should be called with the log dir and prefix "api"
    expect(mockReadLogsFromDir).toHaveBeenCalledWith(
      "/tmp/test-logs",
      "api",
      expect.objectContaining({ limit: 50 }),
    );
  });

  it("defaults source to events when not specified", async () => {
    mockReadLogsFromDir.mockReturnValue([]);

    const req = new Request("http://localhost:3000/api/logs");
    await logsGET(req);

    expect(mockReadLogsFromDir).toHaveBeenCalledWith(
      "/tmp/test-logs",
      "events",
      expect.any(Object),
    );
  });

  it("applies tail parameter (calls tailLogs instead of readLogsFromDir)", async () => {
    const tailEntries = [
      {
        ts: "2026-01-01T00:05:00Z",
        level: "info",
        source: "events",
        sessionId: null,
        message: "last line",
      },
    ];
    mockTailLogs.mockReturnValue(tailEntries);

    const req = new Request("http://localhost:3000/api/logs?tail=10");
    const res = await logsGET(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.entries).toHaveLength(1);
    expect(json.entries[0].message).toBe("last line");

    // tailLogs should be called, NOT readLogsFromDir
    expect(mockTailLogs).toHaveBeenCalledWith("/tmp/test-logs/events.jsonl", 10);
    expect(mockReadLogsFromDir).not.toHaveBeenCalled();
  });

  it("returns 500 when config has no projects", async () => {
    mockResolveProjectLogDir.mockReturnValue(null);
    // resolveLogDir() will throw "No projects configured."

    const req = new Request("http://localhost:3000/api/logs");
    const res = await logsGET(req);
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toMatch(/No projects configured/);
  });
});

// ── GET /api/perf ───────────────────────────────────────────────────────

describe("GET /api/perf", () => {
  const perfLogEntries = [
    {
      ts: "2026-01-01T00:00:00Z",
      level: "info",
      source: "api",
      sessionId: null,
      message: "req",
      data: {
        method: "GET",
        path: "/api/sessions",
        statusCode: 200,
        durationMs: 150,
      },
    },
    {
      ts: "2026-01-01T00:01:00Z",
      level: "info",
      source: "api",
      sessionId: null,
      message: "req",
      data: {
        method: "GET",
        path: "/api/sessions",
        statusCode: 200,
        durationMs: 250,
      },
    },
    {
      ts: "2026-01-01T00:02:00Z",
      level: "info",
      source: "api",
      sessionId: null,
      message: "req",
      data: {
        method: "POST",
        path: "/api/spawn",
        statusCode: 500,
        durationMs: 3000,
        error: "fail",
      },
    },
  ];

  it("returns route stats with count, avgMs, p50Ms, etc.", async () => {
    mockReadLogsFromDir.mockReturnValue(perfLogEntries);

    const req = new Request("http://localhost:3000/api/perf");
    const res = await perfGET(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.routes).toBeDefined();
    expect(json.totalRequests).toBe(3);

    // Two GET /api/sessions entries -> normalized to "GET /api/sessions"
    const sessionRoute = json.routes["GET /api/sessions"];
    expect(sessionRoute).toBeDefined();
    expect(sessionRoute.count).toBe(2);
    expect(sessionRoute.avgMs).toBe(200); // (150 + 250) / 2
    expect(sessionRoute.p50Ms).toBeDefined();
    expect(sessionRoute.p95Ms).toBeDefined();
    expect(sessionRoute.p99Ms).toBeDefined();
    expect(sessionRoute.errors).toBe(0);

    // One POST /api/spawn with statusCode 500 and error
    const spawnRoute = json.routes["POST /api/spawn"];
    expect(spawnRoute).toBeDefined();
    expect(spawnRoute.count).toBe(1);
    expect(spawnRoute.avgMs).toBe(3000);
    expect(spawnRoute.errors).toBe(1);
  });

  it("returns slowest requests sorted by duration", async () => {
    mockReadLogsFromDir.mockReturnValue(perfLogEntries);

    const req = new Request("http://localhost:3000/api/perf");
    const res = await perfGET(req);
    const json = await res.json();

    expect(json.slowest).toBeDefined();
    expect(Array.isArray(json.slowest)).toBe(true);
    expect(json.slowest.length).toBe(3);
    // Sorted descending by duration
    expect(json.slowest[0].durationMs).toBe(3000);
    expect(json.slowest[1].durationMs).toBe(250);
    expect(json.slowest[2].durationMs).toBe(150);
  });

  it("normalizes route paths for grouping", async () => {
    mockReadLogsFromDir.mockReturnValue([
      {
        ts: "2026-01-01T00:00:00Z",
        level: "info",
        source: "api",
        sessionId: null,
        message: "req",
        data: {
          method: "GET",
          path: "/api/sessions/backend-3",
          statusCode: 200,
          durationMs: 100,
        },
      },
      {
        ts: "2026-01-01T00:01:00Z",
        level: "info",
        source: "api",
        sessionId: null,
        message: "req",
        data: {
          method: "GET",
          path: "/api/sessions/frontend-1",
          statusCode: 200,
          durationMs: 200,
        },
      },
    ]);

    const req = new Request("http://localhost:3000/api/perf");
    const res = await perfGET(req);
    const json = await res.json();

    // Both should be grouped under the normalized key
    const normalized = json.routes["GET /api/sessions/:id"];
    expect(normalized).toBeDefined();
    expect(normalized.count).toBe(2);
  });

  it("returns 500 when no projects configured", async () => {
    mockResolveProjectLogDir.mockReturnValue(null);

    const req = new Request("http://localhost:3000/api/perf");
    const res = await perfGET(req);
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toMatch(/No projects configured/);
  });
});

// ── POST /api/client-logs ───────────────────────────────────────────────

describe("POST /api/client-logs", () => {
  it("returns 400 when body has no entries array", async () => {
    const req = new Request("http://localhost:3000/api/client-logs", {
      method: "POST",
      body: JSON.stringify({ something: "else" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await clientLogsPost(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toMatch(/Missing entries/);
  });

  it("returns 400 when body is not an object", async () => {
    const req = new Request("http://localhost:3000/api/client-logs", {
      method: "POST",
      body: JSON.stringify("just a string"),
      headers: { "Content-Type": "application/json" },
    });

    const res = await clientLogsPost(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toMatch(/Invalid request/);
  });

  it("returns 400 when body is invalid JSON", async () => {
    const req = new Request("http://localhost:3000/api/client-logs", {
      method: "POST",
      body: "not json at all",
      headers: { "Content-Type": "application/json" },
    });

    const res = await clientLogsPost(req);
    expect(res.status).toBe(400);
  });

  it("logs valid entries and skips invalid ones", async () => {
    const req = new Request("http://localhost:3000/api/client-logs", {
      method: "POST",
      body: JSON.stringify({
        entries: [
          { level: "info", message: "page loaded", url: "/dashboard" },
          { level: "error", message: "fetch failed", stack: "Error: 500\n  at ..." },
          { level: "invalid-level", message: "bad level" }, // invalid: level not in set
          { notAMessage: true }, // invalid: no message field
          { level: "warn", message: "slow render", timing: { ttfb: 120 } },
        ],
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await clientLogsPost(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.logged).toBe(3); // info, error, warn are valid; 2 invalid skipped

    // Verify append was called 3 times with correct structure
    expect(mockLogWriterAppend).toHaveBeenCalledTimes(3);

    // Check first call (info entry)
    const firstCall = mockLogWriterAppend.mock.calls[0][0];
    expect(firstCall.level).toBe("info");
    expect(firstCall.source).toBe("browser");
    expect(firstCall.message).toBe("page loaded");
    expect(firstCall.data).toEqual({ url: "/dashboard" });

    // Check second call (error entry with stack)
    const secondCall = mockLogWriterAppend.mock.calls[1][0];
    expect(secondCall.level).toBe("error");
    expect(secondCall.message).toBe("fetch failed");
    expect(secondCall.data).toHaveProperty("stack");

    // Check third call (warn entry with timing)
    const thirdCall = mockLogWriterAppend.mock.calls[2][0];
    expect(thirdCall.level).toBe("warn");
    expect(thirdCall.message).toBe("slow render");
    expect(thirdCall.data).toEqual({ timing: { ttfb: 120 } });
  });

  it("returns logged: 0 when writer is unavailable", async () => {
    mockResolveProjectLogDir.mockReturnValue(null);

    // Force re-import to reset the cached logWriter
    // Since logWriter is module-level, we need a fresh module
    vi.resetModules();

    // Re-apply the mock after resetModules
    vi.doMock("@composio/ao-core", () => ({
      resolveProjectLogDir: () => null,
      loadConfig: () => ({}),
      LogWriter: vi.fn().mockImplementation(() => ({
        append: mockLogWriterAppend,
        appendLine: vi.fn(),
        close: vi.fn(),
      })),
    }));

    const { POST: freshPost } = await import("../app/api/client-logs/route.js");

    const req = new Request("http://localhost:3000/api/client-logs", {
      method: "POST",
      body: JSON.stringify({
        entries: [{ level: "info", message: "test" }],
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await freshPost(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.logged).toBe(0);
  });

  it("returns correct count for empty entries array", async () => {
    const req = new Request("http://localhost:3000/api/client-logs", {
      method: "POST",
      body: JSON.stringify({ entries: [] }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await clientLogsPost(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.logged).toBe(0);
  });
});
