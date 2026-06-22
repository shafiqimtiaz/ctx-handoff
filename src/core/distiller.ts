import { jsonrepair } from "jsonrepair";
import { SessionMessage } from "../adapters/types.js";
import { HandoffSections } from "./formatter.js";

/**
 * Optional Gemini pass that distills a raw session into the structured
 * Context Handoff sections, so the sender ships a dense brief instead of
 * noisy chat logs. Uses Google's OpenAI-compatible Chat Completions endpoint,
 * so no SDK is needed — just Node's built-in fetch.
 */
const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

const DEFAULT_MODEL = "gemini-2.5-flash";

const SYSTEM_PROMPT = `You distill an AI coding-agent session into a dense handoff brief for another developer's agent. Strip conversational noise; keep only what the receiving agent needs to continue. Be concrete and terse.

Respond with ONLY a JSON object of this exact shape:
{
  "objective": "the primary goal, one or two sentences",
  "currentState": "where things stand right now and any blockers",
  "completedSteps": "what is already done — one '-' bullet per line",
  "failedApproaches": "approaches that were tried and did not work and must not be retried — '-' bullets, or 'None.'",
  "nextSteps": "the concrete next actions the receiving agent should take — '-' bullets"
}

Leave a field as an empty string only when the session genuinely lacks that information.`;

export function geminiAvailable(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export async function distillSession(messages: SessionMessage[]): Promise<HandoffSections> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set.");
  const model = process.env.GEMINI_MODEL ?? DEFAULT_MODEL;

  const transcript = messages
    .map((m) => `### ${m.role.toUpperCase()}\n${m.content.trim()}`)
    .join("\n\n");

  const res = await fetch(GEMINI_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Distill this session:\n\n${transcript}` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    throw new Error(`Gemini request failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Gemini returned no content.");

  return parseSections(content);
}

function parseSections(content: string): HandoffSections {
  const obj = JSON.parse(extractJson(content)) as Partial<HandoffSections>;
  return {
    objective: str(obj.objective),
    currentState: str(obj.currentState),
    completedSteps: str(obj.completedSteps),
    failedApproaches: str(obj.failedApproaches),
    nextSteps: str(obj.nextSteps),
  };
}

function extractJson(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1].trim() : content;

  // Isolate the JSON from any surrounding prose, then let jsonrepair fix the
  // common ways models still mangle it: trailing commas, single quotes,
  // unquoted keys, truncation (missing closing brackets), and so on.
  const start = body.indexOf("{");
  const candidate =
    start === -1 ? body : (firstBalancedObject(body) ?? body.slice(start));
  return jsonrepair(candidate);
}

// Return the first brace-balanced JSON object, ignoring any prose or extra
// objects the model appends after it (thinking models often do). Tracks string
// literals and escapes so braces inside strings don't throw off the depth count.
function firstBalancedObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
