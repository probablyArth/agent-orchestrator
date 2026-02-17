/**
 * Dashboard rebuild utility — cleans stale build artifacts and rebuilds.
 *
 * Handles three common failure modes:
 * 1. Stale .next cache (e.g., missing vendor-chunks after dependency changes)
 * 2. Missing node_modules in web package
 * 3. Missing built packages (core/plugins not compiled)
 */

import { resolve } from "node:path";
import { existsSync, rmSync } from "node:fs";
import chalk from "chalk";
import ora from "ora";
import { exec, execSilent } from "./shell.js";

/**
 * Find the monorepo root by walking up from the web directory.
 * Looks for pnpm-workspace.yaml as the marker.
 */
function findMonorepoRoot(webDir: string): string | null {
  let dir = resolve(webDir);
  for (let i = 0; i < 10; i++) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Find the PID of a process listening on the given port.
 * Returns null if no process is found.
 */
export async function findRunningDashboardPid(port: number): Promise<string | null> {
  const lsofOutput = await execSilent("lsof", ["-ti", `:${port}`, "-sTCP:LISTEN"]);
  if (!lsofOutput) return null;

  const pid = lsofOutput.split("\n")[0]?.trim();
  if (!pid || !/^\d+$/.test(pid)) return null;
  return pid;
}

/**
 * Find the working directory of a process by PID.
 * Returns null if the cwd can't be determined.
 */
export async function findProcessWebDir(pid: string): Promise<string | null> {
  const lsofDetail = await execSilent("lsof", ["-p", pid, "-Fn"]);
  if (!lsofDetail) return null;

  // lsof -Fn outputs lines like "n/path/to/cwd" — the cwd entry follows "fcwd"
  const lines = lsofDetail.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === "fcwd" && i + 1 < lines.length && lines[i + 1]?.startsWith("n/")) {
      const cwd = lines[i + 1].slice(1);
      if (existsSync(resolve(cwd, "package.json"))) {
        return cwd;
      }
    }
  }

  return null;
}

/**
 * Wait for a port to be free (no process listening).
 */
export async function waitForPortFree(port: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pid = await findRunningDashboardPid(port);
    if (!pid) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

/**
 * Clean just the .next cache directory. Use when a dev server is running —
 * it will recompile on next request. Does NOT run pnpm build (which would
 * create a production .next that the dev server can't use).
 */
export async function cleanNextCache(webDir: string): Promise<void> {
  const nextDir = resolve(webDir, ".next");
  if (existsSync(nextDir)) {
    const spinner = ora();
    spinner.start("Cleaning .next build cache");
    rmSync(nextDir, { recursive: true, force: true });
    spinner.succeed(`Cleaned .next build cache (${webDir})`);
  }
}

/**
 * Clean stale .next cache and rebuild all packages.
 * Use when NO dev server is running — starts fresh with a full build.
 */
export async function rebuildDashboard(webDir: string): Promise<void> {
  const nextDir = resolve(webDir, ".next");
  const spinner = ora();

  console.log(chalk.dim(`  Rebuilding: ${webDir}\n`));

  // Step 1: Clean .next cache
  if (existsSync(nextDir)) {
    spinner.start("Cleaning .next build cache");
    rmSync(nextDir, { recursive: true, force: true });
    spinner.succeed("Cleaned .next build cache");
  }

  // Step 2: Ensure node_modules exist
  if (!existsSync(resolve(webDir, "node_modules"))) {
    const root = findMonorepoRoot(webDir);
    if (root) {
      spinner.start("Installing dependencies (pnpm install)");
      await exec("pnpm", ["install"], { cwd: root });
      spinner.succeed("Dependencies installed");
    }
  }

  // Step 3: Build workspace packages (core + plugins)
  const root = findMonorepoRoot(webDir);
  if (root) {
    spinner.start("Building packages (pnpm build)");
    await exec("pnpm", ["build"], { cwd: root });
    spinner.succeed("Packages built");
  }

  console.log(chalk.green("\nRebuild complete.\n"));
}
