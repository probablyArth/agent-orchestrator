import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  PluginModule,
  Runtime,
  RuntimeCreateConfig,
  RuntimeHandle,
  RuntimeMetrics,
  AttachInfo,
} from "@agent-orchestrator/core";

const execFileAsync = promisify(execFile);

export const manifest = {
  name: "tmux",
  slot: "runtime" as const,
  description: "Runtime plugin: tmux sessions",
  version: "0.1.0",
};

/** Run a tmux command and return stdout */
async function tmux(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("tmux", args);
  return stdout.trimEnd();
}

/** Check if tmux server is running */
async function isTmuxRunning(): Promise<boolean> {
  try {
    await tmux("list-sessions");
    return true;
  } catch {
    return false;
  }
}

export function create(): Runtime {
  return {
    name: "tmux",

    async create(config: RuntimeCreateConfig): Promise<RuntimeHandle> {
      const sessionName = config.sessionId;

      // Build environment flags: -e KEY=VALUE for each env var
      const envArgs: string[] = [];
      for (const [key, value] of Object.entries(config.environment)) {
        envArgs.push("-e", `${key}=${value}`);
      }

      // Create tmux session in detached mode
      await tmux(
        "new-session",
        "-d",
        "-s",
        sessionName,
        "-c",
        config.workspacePath,
        ...envArgs,
      );

      // Send the launch command
      await tmux("send-keys", "-t", sessionName, config.launchCommand, "Enter");

      return {
        id: sessionName,
        runtimeName: "tmux",
        data: {
          createdAt: Date.now(),
          workspacePath: config.workspacePath,
        },
      };
    },

    async destroy(handle: RuntimeHandle): Promise<void> {
      try {
        await tmux("kill-session", "-t", handle.id);
      } catch {
        // Session may already be dead — that's fine
      }
    },

    async sendMessage(handle: RuntimeHandle, message: string): Promise<void> {
      // Wait for idle before sending (up to 60s)
      const maxWait = 60;
      const pollInterval = 2;
      for (let waited = 0; waited < maxWait; waited += pollInterval) {
        if (!(await isBusy(handle.id))) break;
        await sleep(pollInterval * 1000);
      }

      // Clear any partial input
      await tmux("send-keys", "-t", handle.id, "C-u");
      await sleep(200);

      // For long or multiline messages, use load-buffer + paste-buffer
      if (message.includes("\n") || message.length > 200) {
        const tmpPath = join(tmpdir(), `ao-send-${handle.id}-${Date.now()}.txt`);
        writeFileSync(tmpPath, message, "utf-8");
        try {
          await tmux("load-buffer", tmpPath);
          await tmux("paste-buffer", "-t", handle.id);
        } finally {
          try {
            unlinkSync(tmpPath);
          } catch {
            // ignore cleanup errors
          }
        }
      } else {
        await tmux("send-keys", "-t", handle.id, message);
      }

      await sleep(300);
      await tmux("send-keys", "-t", handle.id, "Enter");
    },

    async getOutput(handle: RuntimeHandle, lines = 50): Promise<string> {
      try {
        return await tmux(
          "capture-pane",
          "-t",
          handle.id,
          "-p",
          "-S",
          `-${lines}`,
        );
      } catch {
        return "";
      }
    },

    async isAlive(handle: RuntimeHandle): Promise<boolean> {
      try {
        await tmux("has-session", "-t", handle.id);
        return true;
      } catch {
        return false;
      }
    },

    async getMetrics(handle: RuntimeHandle): Promise<RuntimeMetrics> {
      const createdAt = (handle.data.createdAt as number) ?? Date.now();
      return {
        uptimeMs: Date.now() - createdAt,
      };
    },

    async getAttachInfo(handle: RuntimeHandle): Promise<AttachInfo> {
      return {
        type: "tmux",
        target: handle.id,
        command: `tmux attach -t ${handle.id}`,
      };
    },
  };
}

/** Check if a tmux session is currently busy (agent processing) */
async function isBusy(sessionName: string): Promise<boolean> {
  try {
    const output = await tmux(
      "capture-pane",
      "-t",
      sessionName,
      "-p",
      "-S",
      "-5",
    );
    const lines = output.split("\n").filter((l) => l.trim() !== "");
    const lastLine = lines[lines.length - 1] ?? "";

    // Idle indicators: prompt char, permission mode
    if (/[❯$]|⏵⏵|bypass permissions/.test(lastLine)) {
      return false;
    }

    // Active indicators: processing spinners
    const recentOutput = await tmux(
      "capture-pane",
      "-t",
      sessionName,
      "-p",
      "-S",
      "-3",
    );
    if (recentOutput.includes("esc to interrupt")) {
      return true;
    }

    // Default: assume busy if we can't tell
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default { manifest, create } satisfies PluginModule<Runtime>;
