import { join } from "node:path";
import { existsSync } from "node:fs";
import { AgentAdapter, SessionMessage } from "./types.js";
import { CLAUDE_PROJECTS_ROOT, claudeSlug } from "../core/paths.js";
import {
  findLatestJsonl,
  readJsonl,
  summarizeValue,
} from "../core/session-store.js";

/**
 * Claude Code adapter.
 *
 * Claude Code has no stdout JSON session dump either; sessions live as
 * documented JSONL files at ~/.claude/projects/<slug>/<id>.jsonl. We read the
 * latest one for the current project directory.
 */
export class ClaudeAdapter implements AgentAdapter {
  constructor(private readonly cwd: string = process.cwd()) {}

  getName(): string {
    return "Claude Code";
  }

  static isPresent(cwd: string = process.cwd()): boolean {
    return existsSync(join(CLAUDE_PROJECTS_ROOT, claudeSlug(cwd)));
  }

  async extractSession(): Promise<SessionMessage[]> {
    const dir = join(CLAUDE_PROJECTS_ROOT, claudeSlug(this.cwd));
    const file = findLatestJsonl(dir);
    if (!file) {
      throw new Error(
        `No Claude Code session found for this project (${dir}).`,
      );
    }

    const messages: SessionMessage[] = [];
    for (const line of readJsonl(file)) {
      const entry = line as ClaudeLine;
      if (entry.type !== "user" && entry.type !== "assistant") continue;
      if (!entry.message) continue;
      const text = renderContent(entry.message.content);
      if (!text) continue;
      messages.push({ role: entry.type, content: text });
    }
    return messages;
  }
}

interface ClaudeLine {
  type: string;
  message?: { role: string; content: string | ClaudePart[] };
}

interface ClaudePart {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
}

function renderContent(content: string | ClaudePart[]): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  const out: string[] = [];
  for (const part of content) {
    if (part.type === "text" && part.text) {
      out.push(part.text);
    } else if (part.type === "tool_use") {
      out.push(`[tool: ${part.name ?? "tool"}] ${summarizeValue(part.input)}`);
    } else if (part.type === "tool_result") {
      out.push(`[tool result] ${summarizeValue(extractToolResult(part.content))}`);
    }
  }
  return out.join("\n").trim();
}

function extractToolResult(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === "object" && "text" in p ? (p as { text: string }).text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return summarizeValue(content);
}
