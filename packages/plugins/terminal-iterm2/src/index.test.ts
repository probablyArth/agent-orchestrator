import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { Session } from "@agent-orchestrator/core";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";
import { manifest, create } from "./index.js";

const mockExecFile = execFile as unknown as Mock;

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "app-1",
    projectId: "my-project",
    status: "working",
    activity: "active",
    branch: "feat/test",
    issueId: null,
    pr: null,
    workspacePath: "/tmp/workspace",
    runtimeHandle: null,
    agentInfo: null,
    createdAt: new Date(),
    lastActivityAt: new Date(),
    metadata: {},
    ...overrides,
  };
}

/**
 * Helper to simulate osascript calls.
 * Sets up mockExecFile to call the callback with the given stdout.
 */
function simulateOsascript(stdout: string) {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], cb: (err: Error | null, stdout: string) => void) => {
      cb(null, stdout);
    },
  );
}

function simulateOsascriptSequence(results: string[]) {
  let callIndex = 0;
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], cb: (err: Error | null, stdout: string) => void) => {
      const result = results[callIndex] ?? "NOT_FOUND";
      callIndex++;
      cb(null, result);
    },
  );
}

describe("terminal-iterm2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  describe("manifest", () => {
    it("has correct metadata", () => {
      expect(manifest.name).toBe("iterm2");
      expect(manifest.slot).toBe("terminal");
      expect(manifest.version).toBe("0.1.0");
    });
  });

  describe("create", () => {
    it("returns a terminal with name 'iterm2'", () => {
      const terminal = create();
      expect(terminal.name).toBe("iterm2");
    });

    it("has openSession, openAll, and isSessionOpen methods", () => {
      const terminal = create();
      expect(typeof terminal.openSession).toBe("function");
      expect(typeof terminal.openAll).toBe("function");
      expect(typeof terminal.isSessionOpen).toBe("function");
    });
  });

  describe("openSession", () => {
    it("uses session.id as session name by default", async () => {
      simulateOsascript("NOT_FOUND\n");
      const terminal = create();
      await terminal.openSession(makeSession({ id: "backend-5" }));

      // Two calls: findAndSelectExistingTab (NOT_FOUND) then openNewTab
      expect(mockExecFile).toHaveBeenCalledTimes(2);
      const newTabScript = mockExecFile.mock.calls[1][1][1] as string;
      expect(newTabScript).toContain("backend-5");
    });

    it("uses runtimeHandle.id when available", async () => {
      simulateOsascript("NOT_FOUND\n");
      const terminal = create();
      await terminal.openSession(
        makeSession({
          id: "app-1",
          runtimeHandle: { id: "tmux-session-42", runtimeName: "tmux", data: {} },
        }),
      );

      const newTabScript = mockExecFile.mock.calls[1][1][1] as string;
      expect(newTabScript).toContain("tmux-session-42");
      expect(newTabScript).not.toContain("app-1");
    });

    it("reuses existing tab when found", async () => {
      simulateOsascript("FOUND\n");
      const terminal = create();
      await terminal.openSession(makeSession());

      // Only one call: findAndSelectExistingTab (FOUND) — no openNewTab
      expect(mockExecFile).toHaveBeenCalledTimes(1);
    });

    it("opens new tab when not found", async () => {
      simulateOsascript("NOT_FOUND\n");
      const terminal = create();
      await terminal.openSession(makeSession());

      // Two calls: findAndSelectExistingTab (NOT_FOUND) + openNewTab
      expect(mockExecFile).toHaveBeenCalledTimes(2);
    });
  });

  describe("AppleScript commands", () => {
    it("findAndSelectExistingTab checks profile name", async () => {
      simulateOsascript("NOT_FOUND\n");
      const terminal = create();
      await terminal.openSession(makeSession({ id: "my-session" }));

      const findScript = mockExecFile.mock.calls[0][1][1] as string;
      expect(findScript).toContain('tell application "iTerm2"');
      expect(findScript).toContain("repeat with aWindow in windows");
      expect(findScript).toContain("profile name of aSession");
      expect(findScript).toContain('"my-session"');
    });

    it("openNewTab creates tab and attaches to tmux", async () => {
      simulateOsascript("NOT_FOUND\n");
      const terminal = create();
      await terminal.openSession(makeSession({ id: "app-7" }));

      const openScript = mockExecFile.mock.calls[1][1][1] as string;
      expect(openScript).toContain("create tab with default profile");
      expect(openScript).toContain('set name to "app-7"');
      expect(openScript).toContain("tmux attach -t app-7");
    });

    it("openNewTab sets terminal title via escape sequence", async () => {
      simulateOsascript("NOT_FOUND\n");
      const terminal = create();
      await terminal.openSession(makeSession({ id: "test-1" }));

      const openScript = mockExecFile.mock.calls[1][1][1] as string;
      // Should set tab title via printf escape code
      expect(openScript).toContain("printf");
      expect(openScript).toContain("test-1");
    });

    it("always calls osascript as the command", async () => {
      simulateOsascript("NOT_FOUND\n");
      const terminal = create();
      await terminal.openSession(makeSession());

      for (const call of mockExecFile.mock.calls) {
        expect(call[0]).toBe("osascript");
        expect(call[1][0]).toBe("-e");
      }
    });
  });

  describe("openAll", () => {
    it("does nothing for empty session list", async () => {
      const terminal = create();
      await terminal.openAll([]);
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it("opens tabs for each session", async () => {
      // All sessions are NOT_FOUND
      simulateOsascript("NOT_FOUND\n");
      const terminal = create();
      const sessions = [
        makeSession({ id: "app-1" }),
        makeSession({ id: "app-2" }),
      ];

      const promise = terminal.openAll(sessions);
      // Advance past delays (300ms per session)
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(300);
      await promise;

      // 2 sessions * 2 calls each (find + open) = 4
      expect(mockExecFile).toHaveBeenCalledTimes(4);
    });

    it("skips opening tabs for existing sessions", async () => {
      // First session found, second not found
      simulateOsascriptSequence(["FOUND\n", "NOT_FOUND\n", ""]);
      const terminal = create();
      const sessions = [
        makeSession({ id: "existing-1" }),
        makeSession({ id: "new-1" }),
      ];

      const promise = terminal.openAll(sessions);
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(300);
      await promise;

      // existing-1: 1 call (find=FOUND), new-1: 2 calls (find=NOT_FOUND + open)
      expect(mockExecFile).toHaveBeenCalledTimes(3);
    });
  });

  describe("isSessionOpen", () => {
    it("returns true when tab exists", async () => {
      simulateOsascript("FOUND\n");
      const terminal = create();
      const result = await terminal.isSessionOpen!(makeSession({ id: "app-1" }));
      expect(result).toBe(true);
    });

    it("returns false when tab does not exist", async () => {
      simulateOsascript("NOT_FOUND\n");
      const terminal = create();
      const result = await terminal.isSessionOpen!(makeSession({ id: "app-1" }));
      expect(result).toBe(false);
    });

    it("returns false when osascript fails", async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], cb: (err: Error | null, stdout: string) => void) => {
          cb(new Error("osascript failed"), "");
        },
      );
      const terminal = create();
      const result = await terminal.isSessionOpen!(makeSession());
      expect(result).toBe(false);
    });
  });
});
