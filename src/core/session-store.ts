import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SessionMessage } from "../adapters/types.js";

export interface JsonlFile {
  /** Filename without the .jsonl extension. */
  id: string;
  path: string;
  mtime: number;
}

/** List *.jsonl files in a directory, newest first. Empty if none/absent. */
export function listJsonl(dir: string): JsonlFile[] {
  if (!existsSync(dir)) return [];
  const files: JsonlFile[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const path = join(dir, name);
    files.push({ id: name.slice(0, -".jsonl".length), path, mtime: statSync(path).mtimeMs });
  }
  return files.sort((a, b) => b.mtime - a.mtime);
}

/** Build a one-line session title from the first user message. */
export function sessionTitle(messages: SessionMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  const line = first?.content.replace(/\s+/g, " ").trim() ?? "";
  if (!line) return "Untitled session";
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
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
