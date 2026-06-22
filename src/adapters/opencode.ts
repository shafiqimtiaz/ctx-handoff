import { AgentAdapter, SessionMessage } from "./types.js";
import { run, commandExists } from "../core/exec.js";
import { summarizeValue } from "../core/session-store.js";

/**
 * OpenCode adapter.
 *
 * OpenCode exposes a real session export CLI, so this adapter follows the
 * "use the native CLI" rule strictly:
 *   1. `opencode session list`   -> newest session id for this project
 *   2. `opencode export <id>`    -> full session as JSON
 */
export class OpenCodeAdapter implements AgentAdapter {
  private static readonly BIN = "opencode";

  getName(): string {
    return "OpenCode";
  }

  static isPresent(): boolean {
    return commandExists(OpenCodeAdapter.BIN);
  }

  async extractSession(): Promise<SessionMessage[]> {
    const sessionId = await this.latestSessionId();
    if (!sessionId) {
      throw new Error("No OpenCode session found for this project.");
    }

    const { stdout, code, stderr } = await run(
      OpenCodeAdapter.BIN,
      ["export", sessionId],
      { timeoutMs: 120_000 },
    );
    if (code !== 0) {
      throw new Error(`opencode export failed: ${stderr.trim() || `exit ${code}`}`);
    }

    let parsed: OpenCodeExport;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new Error("Could not parse `opencode export` output as JSON.");
    }

    const messages: SessionMessage[] = [];
    for (const msg of parsed.messages ?? []) {
      const role = msg.info?.role === "assistant" ? "assistant" : "user";
      const text = renderParts(msg.parts ?? []);
      if (text) messages.push({ role, content: text });
    }
    return messages;
  }

  private async latestSessionId(): Promise<string | null> {
    const { stdout, code, stderr } = await run(
      OpenCodeAdapter.BIN,
      ["session", "list"],
      { timeoutMs: 60_000 },
    );
    if (code !== 0) {
      throw new Error(`opencode session list failed: ${stderr.trim() || `exit ${code}`}`);
    }
    // Rows are sorted newest-first; the id is the first `ses_…` token per line.
    for (const line of stdout.split("\n")) {
      const match = /\bses_\S+/.exec(line);
      if (match) return match[0];
    }
    return null;
  }
}

interface OpenCodeExport {
  info?: { directory?: string };
  messages?: Array<{
    info?: { role?: string };
    parts?: OpenCodePart[];
  }>;
}

interface OpenCodePart {
  type: string;
  text?: string;
  tool?: string;
  state?: { input?: unknown; output?: unknown };
}

function renderParts(parts: OpenCodePart[]): string {
  const out: string[] = [];
  for (const part of parts) {
    if (part.type === "text" && part.text) {
      out.push(part.text);
    } else if (part.type === "tool") {
      const name = part.tool ?? "tool";
      out.push(`[tool: ${name}] ${summarizeValue(part.state?.input)}`);
    }
    // reasoning / step-start / step-finish are skipped.
  }
  return out.join("\n").trim();
}
