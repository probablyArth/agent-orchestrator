/**
 * Integration test: spawn pipeline keeps agent alive.
 *
 * Validates the fix for the `-p` (one-shot exit) bug. Uses a stub agent
 * (simple shell script) wired through real tmux runtime, verifying the
 * spawned process stays alive instead of exiting immediately.
 *
 * Requires: tmux installed and running.
 * Does NOT require: Claude Code binary, API keys, or git repos.
 */

import { mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import tmuxPlugin from "@composio/ao-plugin-runtime-tmux";
import type { RuntimeHandle, Agent, AgentLaunchConfig } from "@composio/ao-core";
import { isTmuxAvailable, killSessionsByPrefix } from "./helpers/tmux.js";
import { sleep } from "./helpers/polling.js";

const tmuxOk = await isTmuxAvailable();
const SESSION_PREFIX = "ao-inttest-spawn-alive-";

/**
 * Stub agent that stays alive. Returns a simple bash loop as the launch
 * command — this replaces Claude Code for testing the spawn pipeline.
 */
function createStubAgent(): Agent {
  return {
    name: "stub",
    processName: "bash",

    getLaunchCommand(_config: AgentLaunchConfig): string {
      // Simple loop that stays alive — the key property being tested
      return "bash -c 'while true; do sleep 1; done'";
    },

    getEnvironment(): Record<string, string> {
      return {};
    },

    detectActivity(): "active" {
      return "active";
    },

    async getActivityState(): Promise<"active"> {
      return "active";
    },

    async isProcessRunning(handle: RuntimeHandle): Promise<boolean> {
      const runtime = tmuxPlugin.create();
      return runtime.isAlive(handle);
    },

    async getSessionInfo(): Promise<null> {
      return null;
    },
  } as Agent;
}

describe.skipIf(!tmuxOk)("spawn pipeline keeps agent alive (integration)", () => {
  const runtime = tmuxPlugin.create();
  const sessionName = `${SESSION_PREFIX}${Date.now()}`;
  let tmpDir: string;
  let handle: RuntimeHandle;

  beforeAll(async () => {
    await killSessionsByPrefix(SESSION_PREFIX);
    const raw = await mkdtemp(join(tmpdir(), "ao-inttest-spawn-alive-"));
    tmpDir = await realpath(raw);
  }, 30_000);

  afterAll(async () => {
    try {
      if (handle) await runtime.destroy(handle);
    } catch {
      /* best-effort */
    }
    await killSessionsByPrefix(SESSION_PREFIX);
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 30_000);

  it("stub agent launch command keeps process alive in tmux", async () => {
    const agent = createStubAgent();

    // Get the launch command (same as session-manager does)
    const launchCommand = agent.getLaunchCommand({
      sessionId: sessionName,
      projectConfig: {
        name: "test",
        repo: "test/test",
        path: tmpDir,
        defaultBranch: "main",
        sessionPrefix: "test",
      },
    });

    // Create tmux session with the launch command (same as runtime.create)
    handle = await runtime.create({
      sessionId: sessionName,
      workspacePath: tmpDir,
      launchCommand,
      environment: {},
    });

    expect(handle.id).toBe(sessionName);
    expect(handle.runtimeName).toBe("tmux");
  });

  it("process is alive immediately after spawn", async () => {
    expect(await runtime.isAlive(handle)).toBe(true);
  });

  it("process stays alive after 3 seconds (not one-shot exit)", async () => {
    await sleep(3_000);
    expect(await runtime.isAlive(handle)).toBe(true);
  });

  it("session can be destroyed cleanly", async () => {
    await runtime.destroy(handle);
    expect(await runtime.isAlive(handle)).toBe(false);
  });
});
