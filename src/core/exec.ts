import { spawn, spawnSync } from "node:child_process";
import { AgentNotFoundError } from "../adapters/types.js";

/** Cheap, synchronous check that a binary is resolvable on PATH. */
export function commandExists(binary: string): boolean {
  const res = spawnSync(binary, ["--version"], { stdio: "ignore" });
  return !res.error;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * Run a binary and capture stdout/stderr. Rejects with AgentNotFoundError if
 * the binary is missing (ENOENT). Never uses a shell, so arguments are passed
 * safely without interpolation.
 */
export function run(
  binary: string,
  args: string[],
  opts: { input?: string; timeoutMs?: number } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          if (settled) return;
          settled = true;
          child.kill("SIGKILL");
          reject(new Error(`'${binary}' timed out after ${opts.timeoutMs}ms.`));
        }, opts.timeoutMs)
      : null;

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(new AgentNotFoundError(binary));
      } else {
        reject(err);
      }
    });

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });

    if (opts.input !== undefined) {
      child.stdin.write(opts.input);
    }
    child.stdin.end();
  });
}
