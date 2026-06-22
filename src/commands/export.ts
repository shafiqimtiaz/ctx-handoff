import * as p from "@clack/prompts";
import { detectAgents, createAdapter, AgentId, SUPPORTED_AGENTS } from "../adapters/index.js";
import { SessionMessage, AgentNotFoundError } from "../adapters/types.js";
import { formatToHandoffSkill, HandoffSections } from "../core/formatter.js";
import { encrypt } from "../core/crypto.js";
import { uploadPayload } from "../core/transport.js";
import { encodeLink } from "../core/link.js";

export interface ExportOptions {
  agent?: AgentId;
  worker?: string;
}

export async function runExport(opts: ExportOptions): Promise<void> {
  p.intro("handoff export");

  const workerHost = opts.worker ?? process.env.HANDOFF_WORKER;
  if (!workerHost) {
    p.cancel(
      "No worker host. Pass --worker <host> or set HANDOFF_WORKER (e.g. handoff.you.workers.dev).",
    );
    process.exitCode = 1;
    return;
  }

  const agentId = await resolveAgent(opts.agent);
  if (!agentId) return;

  const adapter = createAdapter(agentId);
  const spin = p.spinner();
  spin.start(`Extracting session from ${adapter.getName()}`);
  let messages: SessionMessage[];
  try {
    messages = await adapter.extractSession();
  } catch (err) {
    spin.stop("Extraction failed.");
    p.cancel(err instanceof AgentNotFoundError ? err.message : String((err as Error).message));
    process.exitCode = 1;
    return;
  }
  spin.stop(`Extracted ${messages.length} messages.`);

  if (messages.length === 0) {
    p.cancel("Session has no messages to hand off.");
    process.exitCode = 1;
    return;
  }

  const sections = await promptSections();
  if (sections === null) return;

  const appendix = await curateAppendix(messages);
  if (appendix === null) return;

  const markdown = formatToHandoffSkill({
    sourceAgent: adapter.getName(),
    timestamp: new Date().toISOString(),
    allMessages: messages,
    appendix,
    sections,
  });

  const password = await p.password({
    message: "Set a password (the receiver needs it to decrypt):",
    validate: (v) => (v.length < 4 ? "Use at least 4 characters." : undefined),
  });
  if (p.isCancel(password)) {
    cancelled();
    return;
  }

  const payload = encrypt(markdown, password);

  spin.start("Uploading encrypted handoff");
  let id: string;
  try {
    id = await uploadPayload(workerHost, payload);
  } catch (err) {
    spin.stop("Upload failed.");
    p.cancel(String((err as Error).message));
    process.exitCode = 1;
    return;
  }
  spin.stop("Uploaded.");

  const link = encodeLink({ workerHost, id, password });
  p.note(link, "Share this link (expires in 24h)");
  p.outro("Done.");
}

async function resolveAgent(preset?: AgentId): Promise<AgentId | null> {
  if (preset) {
    if (!SUPPORTED_AGENTS.includes(preset)) {
      p.cancel(`Unknown agent '${preset}'. Supported: ${SUPPORTED_AGENTS.join(", ")}.`);
      process.exitCode = 1;
      return null;
    }
    return preset;
  }

  const detected = detectAgents();
  if (detected.length === 0) {
    p.cancel("No agent session detected here. Use --agent <pi|claude|opencode>.");
    process.exitCode = 1;
    return null;
  }
  if (detected.length === 1) return detected[0];

  const choice = await p.select({
    message: "Which agent session to hand off?",
    options: detected.map((id) => ({ value: id, label: id })),
  });
  if (p.isCancel(choice)) {
    cancelled();
    return null;
  }
  return choice as AgentId;
}

async function promptSections(): Promise<Partial<HandoffSections> | null> {
  const wants = await p.confirm({
    message: "Add a written summary (objective, blockers, next steps)? Recommended.",
    initialValue: true,
  });
  if (p.isCancel(wants)) {
    cancelled();
    return null;
  }
  if (!wants) return {};

  const fields: Array<[keyof HandoffSections, string]> = [
    ["objective", "Primary objective"],
    ["currentState", "Current state & blockers"],
    ["completedSteps", "Completed steps (one per line)"],
    ["failedApproaches", "Failed approaches — do not retry"],
    ["nextSteps", "Next steps for the receiver"],
  ];

  const sections: Partial<HandoffSections> = {};
  for (const [key, label] of fields) {
    const value = await p.text({ message: label, placeholder: "(optional, Enter to skip)" });
    if (p.isCancel(value)) {
      cancelled();
      return null;
    }
    if (value.trim()) sections[key] = value.trim();
  }
  return sections;
}

async function curateAppendix(messages: SessionMessage[]): Promise<SessionMessage[] | null> {
  // Default to selecting the most recent 10 messages.
  const recentFrom = Math.max(0, messages.length - 10);
  const options = messages.map((m, i) => ({
    value: i,
    label: `[${m.role}] ${preview(m.content)}`,
  }));

  const selected = await p.multiselect({
    message: "Select messages for the Raw Context Appendix (space to toggle):",
    options,
    initialValues: options.slice(recentFrom).map((o) => o.value),
    required: false,
  });
  if (p.isCancel(selected)) {
    cancelled();
    return null;
  }
  return (selected as number[]).map((i) => messages[i]);
}

function preview(content: string): string {
  const line = content.replace(/\s+/g, " ").trim();
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}

function cancelled(): null {
  p.cancel("Cancelled.");
  process.exitCode = 130;
  return null;
}
