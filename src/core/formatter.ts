import { SessionMessage } from "../adapters/types.js";

/**
 * The six human-authored sections of the Context Handoff Skill Standard. Any field the
 * sender does not provide falls back to a best-effort default derived from the
 * session, or an explicit "_Not specified_" marker.
 */
export interface HandoffSections {
  objective: string;
  currentState: string;
  completedSteps: string;
  failedApproaches: string;
  nextSteps: string;
}

export interface HandoffInput {
  sourceAgent: string;
  timestamp: string;
  /** Messages the sender curated for the Raw Context Appendix. */
  appendix: SessionMessage[];
  /** Full message list, used only to derive defaults. */
  allMessages: SessionMessage[];
  sections?: Partial<HandoffSections>;
}

const NOT_SPECIFIED = "_Not specified by sender._";

export function formatToHandoffSkill(input: HandoffInput): string {
  const { sourceAgent, timestamp, appendix, allMessages, sections = {} } = input;

  const firstUser = allMessages.find((m) => m.role === "user")?.content ?? "";
  const originalTask = firstLine(firstUser) || NOT_SPECIFIED;

  const objective = sections.objective?.trim() || originalTask;
  const currentState = sections.currentState?.trim() || NOT_SPECIFIED;
  const completedSteps = sections.completedSteps?.trim() || NOT_SPECIFIED;
  const failedApproaches = sections.failedApproaches?.trim() || NOT_SPECIFIED;
  const nextSteps = sections.nextSteps?.trim() || NOT_SPECIFIED;

  return [
    `# Context Handoff Document`,
    `**Source Agent:** ${sourceAgent}`,
    `**Timestamp:** ${timestamp}`,
    `**Original Task:** ${originalTask}`,
    ``,
    `## 1. Primary Objective`,
    objective,
    ``,
    `## 2. Current State & Blockers`,
    currentState,
    ``,
    `## 3. Completed Steps`,
    completedSteps,
    ``,
    `## 4. Failed Approaches (Do Not Retry)`,
    failedApproaches,
    ``,
    `## 5. Next Steps`,
    nextSteps,
    ``,
    `## 6. Raw Context Appendix`,
    renderAppendix(appendix),
    ``,
  ].join("\n");
}

function renderAppendix(messages: SessionMessage[]): string {
  if (messages.length === 0) return "_No raw context included._";
  return messages
    .map((m) => {
      const label = m.role.toUpperCase();
      return `### ${label}\n\n${m.content.trim()}`;
    })
    .join("\n\n---\n\n");
}

function firstLine(text: string): string {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return "";
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}
