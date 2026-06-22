export interface SessionMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AgentAdapter {
  /** Human-readable agent name, e.g. "Pi" or "Claude Code". */
  getName(): string;
  /**
   * Extract the active/most-recent session as an ordered message list by
   * shelling out to the agent's native CLI. Throws AgentNotFoundError if the
   * underlying binary is missing.
   */
  extractSession(): Promise<SessionMessage[]>;
}

export class AgentNotFoundError extends Error {
  constructor(public readonly binary: string) {
    super(
      `Agent '${binary}' not found. Is it installed and in your PATH?`,
    );
    this.name = "AgentNotFoundError";
  }
}
