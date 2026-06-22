import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Return the newest *.jsonl file in a directory, or null if none/absent. */
export function findLatestJsonl(dir: string): string | null {
  if (!existsSync(dir)) return null;
  let newest: { path: string; mtime: number } | null = null;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const path = join(dir, name);
    const mtime = statSync(path).mtimeMs;
    if (!newest || mtime > newest.mtime) newest = { path, mtime };
  }
  return newest?.path ?? null;
}

/** Parse a JSON-lines file into objects, skipping blank/malformed lines. */
export function readJsonl(path: string): unknown[] {
  const out: unknown[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      /* skip partial/corrupt line */
    }
  }
  return out;
}

/** Truncate long tool payloads so the appendix stays readable. */
export function summarizeValue(value: unknown, max = 600): string {
  if (value === undefined || value === null) return "";
  const str = typeof value === "string" ? value : JSON.stringify(value);
  return str.length > max ? `${str.slice(0, max)}… [truncated]` : str;
}
