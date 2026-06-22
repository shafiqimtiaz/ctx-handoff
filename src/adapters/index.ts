import { AgentAdapter } from "./types.js";
import { PiAdapter } from "./pi.js";
import { ClaudeAdapter } from "./claude.js";
import { OpenCodeAdapter } from "./opencode.js";

export type AgentId = "pi" | "claude" | "opencode";

/** Construct an adapter by id. */
export function createAdapter(id: AgentId, cwd: string = process.cwd()): AgentAdapter {
  switch (id) {
    case "pi":
      return new PiAdapter(cwd);
    case "claude":
      return new ClaudeAdapter(cwd);
    case "opencode":
      return new OpenCodeAdapter();
  }
}

export const SUPPORTED_AGENTS: AgentId[] = ["pi", "claude", "opencode"];

/**
 * Auto-detect which agents have a session in the current project. Returns ids
 * in priority order.
 */
export function detectAgents(cwd: string = process.cwd()): AgentId[] {
  const found: AgentId[] = [];
  if (PiAdapter.isPresent(cwd)) found.push("pi");
  if (ClaudeAdapter.isPresent(cwd)) found.push("claude");
  if (OpenCodeAdapter.isPresent()) found.push("opencode");
  return found;
}

export { AgentAdapter } from "./types.js";
