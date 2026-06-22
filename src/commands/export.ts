import * as p from "@clack/prompts";
import { detectAgents, createAdapter, AgentId, SUPPORTED_AGENTS } from "../adapters/index.js";
import { SessionMessage, SessionRef, AgentNotFoundError } from "../adapters/types.js";
import { formatToHandoffSkill, HandoffSections } from "../core/formatter.js";
import { distillSession, geminiAvailable } from "../core/distiller.js";
import { encrypt } from "../core/crypto.js";
import { uploadPayload } from "../core/transport.js";
import { encodeLink } from "../core/link.js";

export interface ExportOptions {
  agent?: AgentId;
  worker?: string;
}

export async function runExport(opts: ExportOptions): Promise<void> {
  p.intro("ctx-handoff export");

  const workerHost = opts.worker ?? process.env.CTX_HANDOFF_WORKER;
  if (!workerHost) {
    p.cancel(
      "No worker host. Pass --worker <host> or set CTX_HANDOFF_WORKER (e.g. your-project.deno.net).",
    );
    process.exitCode = 1;
    return;
  }

  const agentId = await resolveAgent(opts.agent);
  if (!agentId) return;

  const adapter = createAdapter(agentId);
  const spin = p.spinner();

  spin.start(`Listing sessions from ${adapter.getName()}`);
  let sessions: SessionRef[];
  try {
    sessions = await adapter.listSessions();
  } catch (err) {
    spin.stop("Listing failed.");
    p.cancel(err instanceof AgentNotFoundError ? err.message : String((err as Error).message));
    process.exitCode = 1;
    return;
  }
  spin.stop(`Found ${sessions.length} session(s).`);

  if (sessions.length === 0) {
    p.cancel("No sessions found to hand off.");
    process.exitCode = 1;
    return;
  }

  const chosen = await chooseSessions(sessions);
  if (chosen === null) return;

  spin.start(`Extracting ${chosen.length} session(s)`);
  let messages: SessionMessage[];
  try {
    messages = await extractMerged(adapter, chosen);
  } catch (err) {
    spin.stop("Extraction failed.");
    p.cancel(err instanceof AgentNotFoundError ? err.message : String((err as Error).message));
    process.exitCode = 1;
    return;
  }
  spin.stop(`Extracted ${messages.length} messages from ${chosen.length} session(s).`);

  if (messages.length === 0) {
    p.cancel("Selected session(s) have no messages to hand off.");
    process.exitCode = 1;
    return;
  }

  let sections: Partial<HandoffSections>;
  let appendix: SessionMessage[];

  if (geminiAvailable()) {
    spin.start("Distilling session with Gemini");
    try {
      sections = await distillSession(messages);
      appendix = [];
      spin.stop("Distilled into a handoff brief.");
    } catch (err) {
      spin.stop("Distillation failed — falling back to manual.");
      p.log.warn(String((err as Error).message));
      const manual = await runManual(messages);
      if (manual === null) return;
      ({ sections, appendix } = manual);
    }
  } else {
    const manual = await runManual(messages);
    if (manual === null) return;
    ({ sections, appendix } = manual);
  }

  const markdown = formatToHandoffSkill({
    sourceAgent: adapter.getName(),
    timestamp: new Date().toISOString(),
    allMessages: messages,
    appendix,
    sections,
  });

  const password = await resolvePassword();
  if (password === null) return;

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

  const link = encodeLink({ workerHost, id });
  p.note(link, "Share this link (expires in 24h)");
  p.log.info("Share the password separately — the receiver is prompted for it.");
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

/** Pick which sessions to hand off. Newest pre-checked; one is auto-selected. */
async function chooseSessions(sessions: SessionRef[]): Promise<SessionRef[] | null> {
  if (sessions.length === 1 || !process.stdin.isTTY) {
    return [sessions[0]]; // single session, or non-interactive → newest only
  }

  const selected = await p.multiselect({
    message: "Select sessions to hand off (newest pre-checked):",
    options: sessions.map((s) => ({ value: s.id, label: sessionLabel(s) })),
    initialValues: [sessions[0].id],
    required: true,
  });
  if (p.isCancel(selected)) {
    cancelled();
    return null;
  }
  const ids = new Set(selected as string[]);
  return sessions.filter((s) => ids.has(s.id));
}

function sessionLabel(s: SessionRef): string {
  return s.messageCount != null ? `${s.title} (${s.messageCount} msgs)` : s.title;
}

/** Extract chosen sessions and merge them chronologically (oldest first). */
async function extractMerged(
  adapter: ReturnType<typeof createAdapter>,
  chosen: SessionRef[],
): Promise<SessionMessage[]> {
  const ordered = [...chosen].sort((a, b) => a.mtime - b.mtime);
  const messages: SessionMessage[] = [];
  for (const ref of ordered) {
    messages.push(...(await adapter.extractSession(ref.id)));
  }
  return messages;
}

async function resolvePassword(): Promise<string | null> {
  const fromEnv = process.env.CTX_HANDOFF_PASSWORD;
  if (fromEnv) {
    if (fromEnv.length < 4) {
      p.cancel("CTX_HANDOFF_PASSWORD must be at least 4 characters.");
      process.exitCode = 1;
      return null;
    }
    return fromEnv;
  }

  const password = await p.password({
    message: "Set a password (the receiver needs it to decrypt):",
    validate: (v) => (v.length < 4 ? "Use at least 4 characters." : undefined),
  });
  if (p.isCancel(password)) {
    cancelled();
    return null;
  }
  return password;
}

interface ManualResult {
  sections: Partial<HandoffSections>;
  appendix: SessionMessage[];
}

async function runManual(messages: SessionMessage[]): Promise<ManualResult | null> {
  const sections = await promptSections();
  if (sections === null) return null;

  const appendix = await curateAppendix(messages);
  if (appendix === null) return null;

  return { sections, appendix };
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
