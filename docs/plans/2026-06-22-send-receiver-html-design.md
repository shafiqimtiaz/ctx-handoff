# `send` Rename + Receiver-Side HTML Brief

**Date:** 2026-06-22
**Status:** Validated design
**Scope:** Sender rename, sender-side topic-aware distillation, receiver-side HTML brief flow

## Goals

1. Rename the `export` command to `send`. Hard break — no aliases.
2. Sender-side Gemini prompt becomes topic-aware: when multiple sessions on different topics are merged, the distillation surfaces that structure in the output.
3. Receiver-side flow: pick the target coding agent (pi / claude / opencode), drop the brief into the agent's project folder, optionally render an HTML preview for human review, then offer to launch the agent with the brief injected.
4. Gemini key is optional on the receiver side. Without it, the flow still works — just no HTML preview.

## Non-Goals

- No team-shared artifact (the markdown lives in the receiver's local project; the sender's link is unchanged).
- No new encryption, transport, or session-pick logic. The receive command's existing crypto / download pipeline is reused.
- No backward compatibility with the `export` command name. The tool is still in dev (no public adoption).

## Module Changes

| File | Change |
|---|---|
| `src/commands/export.ts` | Rename to `send.ts`. `runExport` → `runSend`. |
| `src/index.ts` | `program.command("export")` → `program.command("send")`. |
| `src/core/distiller.ts` | Topic-aware system prompt. New `topics: string[]` field in output. Transcript gets session-boundary markers. |
| `src/core/formatter.ts` | Render topic sub-headers when `topics` is present. Single-topic output is byte-identical to current behavior. |
| `src/core/receiver-brief.ts` | **New.** Owns the post-decryption flow: agent target pick, file drop, optional Gemini render, HTML open, injection confirmation. Mirrors the `handoff-builder.ts` shape — testable behind a `Prompter` interface. |
| `src/core/receiver-prompts.ts` | **New.** Exports `RECEIVER_SYSTEM_PROMPT`, `RECEIVER_HTML_SCAFFOLD`, and `distillToHtmlAndMarkdown(decrypted, agentId)`. |
| `src/commands/receive.ts` | Thin shell: download → decrypt → call `core/receiver-brief.ts` → spawn agent if confirmed. |
| `src/core/handoff-builder.ts` | Update `buildHandoff` to thread `extractMerged`-style session boundaries into the distillation transcript. |
| Tests | New `distiller.test.ts`, `receiver-brief.test.ts`, `receiver-prompts.test.ts`, `receive-command.test.ts`. Extend `formatter.test.ts`. |
| `README.md` | Update command name, add `send` flow description. |

## Sender-Side: Topic-Aware Distillation

### Transcript markers

The merged-session transcript in `distillSession` inserts session-boundary markers using `sessionTitle()`:

```
### === SESSION 1: <title> (<N> msgs) ===
### USER
…
### ASSISTANT
…

### === SESSION 2: <title> (<M> msgs) ===
### USER
…
```

### Schema change

The 5-field JSON output is preserved. One new optional field, `topics`:

```json
{
  "topics": ["Refactor distiller prompts", "Add Hindsight recall to receive flow"],
  "objective": "Two parallel workstreams…",
  "currentState": "Topic 1: …\n\nTopic 2: …",
  "completedSteps": "### Refactor distiller prompts\n- step\n- step\n\n### Add Hindsight recall\n- step",
  "failedApproaches": "…",
  "nextSteps": "…"
}
```

When the merged sessions are a single coherent topic, `topics` is omitted (or empty). The 5 existing fields are written as a composite with `### <Topic>` sub-headers inside bullet lists and prose fields whenever `topics.length > 1`.

### Prompt rewrite

`SYSTEM_PROMPT` in `distiller.ts` is updated to:

1. Explain the `### === SESSION n: … ===` markers.
2. Instruct Gemini to detect distinct topics across sessions.
3. Instruct the composite-with-sub-headers formatting when `topics.length > 1`.
4. Keep the terse-dense-brief posture of the current prompt.

### Formatter change

`formatter.ts` reads `topics`. When present, the 5 narrative sections render the topic sub-headers from the Gemini output verbatim. When absent, output is byte-identical to today.

## Receiver-Side: New TUI Flow

`runReceive` becomes a thin shell. The bulk of the logic moves to `core/receiver-brief.ts`:

1. **Decrypt** (existing — unchanged).
2. **HTML preview prompt** (only if `GEMINI_API_KEY` is set): `p.confirm({ message: "Render an HTML preview with Gemini?", initialValue: true })`. If no, skip steps 3–4.
3. **Agent target picker**: `p.select({ message: "Which coding agent to hand off to?", options: [{value: "pi", label: "Pi"}, {value: "claude", label: "Claude Code"}, {value: "opencode", label: "OpenCode"}] })`. Driven by `AgentId` union.
4. **File drop**:
   - Target dir: `<cwd>/.<agentId>/` (e.g. `.claude/`, `.pi/`, `.opencode/`). Create if missing.
   - If `<agentDir>/handoff.md` exists, confirm overwrite with `initialValue: false`.
   - Markdown: write to `<agentDir>/handoff.md`. If step 2 was yes, the markdown is the receiver-Gemini output; else, it's the decrypted markdown verbatim.
   - HTML (only if step 2 was yes): write to `$TMPDIR/handoff-<timestamp>.html` (fallback `/tmp`). Auto-open with `xdg-open` / `open` / `start` per platform. On failure, print the path via `p.note`.
5. **Injection confirmation**: `p.confirm({ message: "Launch <agent> with this handoff injected?", initialValue: true })`.
6. **Spawn** (if confirmed): existing `INJECTION_PREAMBLE + markdown + userRequest` injection into the picked agent via `spawn(bin, [...flags, injection])`. If user declined, print the file paths and a hint to launch manually.

The `userRequest` (CLI args after `--`) is threaded through unchanged.

## Receiver-Side: Gemini HTML + Markdown Generation

`src/core/receiver-prompts.ts` exports:

- `RECEIVER_SYSTEM_PROMPT` — instructs Gemini to preserve every fact from the input markdown, tighten the markdown for the chosen agent, and render the HTML using the supplied scaffold.
- `RECEIVER_HTML_SCAFFOLD` — a full `<!doctype html>…</html>` Tailwind + Mermaid template with placeholders for `{{title}}`, `{{source_agent}}`, `{{date}}`, `{{topic_chips}}`, `{{objective_body}}`, `{{current_state_body}}`, `{{completed_steps_body}}`, `{{failed_approaches_body}}`, `{{next_steps_body}}`, `{{raw_appendix_body}}`.
- `distillToHtmlAndMarkdown(decrypted: string, agentId: AgentId): Promise<{ markdown: string; html: string }>` — fetches Gemini with `response_format: json_object`, parses both fields, repairs JSON via `jsonrepair` if needed.

The system prompt content (paraphrased):

> You are refining a handoff brief that another developer is about to receive. The input is a Markdown handoff document. Produce a JSON object with `markdown` (the file written to the receiver's coding-agent project folder) and `html` (a self-contained browser page for the receiver to review). Preserve every fact from the input. Make the markdown slightly tighter and more action-oriented for the chosen agent. Make the HTML editorial and scannable using the supplied scaffold. The Raw Context Appendix must be present in the markdown but collapsed by default in the HTML (`<details><summary>`).

`agentId` is passed as a `user` message parameter (`agent: claude` / `pi` / `opencode`) so Gemini can adjust verbosity.

## Visual Style Mapping

From `improve-codebase-architecture/HTML-REPORT.md`, the receiver HTML borrows:

- Tailwind via CDN, Mermaid via CDN (ESM import).
- `bg-stone-50 text-slate-900 font-sans`, `max-w-5xl mx-auto px-6 py-12 space-y-12`.
- Serif headings on the page title.
- `text-xs uppercase tracking-wider` for section labels.
- Emerald accent on the topic-count chip; amber for warnings.
- Hand-built Tailwind cards for the 6 handoff sections.

**Not** borrowed (no analogue in a handoff):

- Candidate cards, before/after diagrams, recommendation-strength badges, top-recommendation section, architecture-vocabulary words.

HTML structure:

- `<header>`: project name (basename of cwd), date, source agent, topic count chip.
- 6 `<section>` cards: Primary Objective, Current State & Blockers, Completed Steps, Failed Approaches, Next Steps, Raw Context Appendix.
- When `topics` is present, topic names are shown as a chip row beneath the page title; the 5 narrative sections carry the `### <Topic>` sub-headers from the markdown through.
- Raw Appendix is a `<details><summary>Raw context (N messages)</summary>…</details>`, collapsed by default.

## Error Handling

| Condition | Behavior |
|---|---|
| No `GEMINI_API_KEY` | Skip HTML branch; write decrypted markdown verbatim. |
| Gemini call fails | Warn via `p.log.warn`; write decrypted markdown verbatim; continue. |
| `xdg-open` / `open` / `start` not found | Print HTML path via `p.note`; do not error. |
| `$TMPDIR` not writable | Fall back to `/tmp`. If both fail, error. |
| `<cwd>/.<agentId>/` not writable | Error early with the failing path. No partial writes. |
| `handoff.md` already exists | Confirm overwrite (default no). |
| No agent selected (user cancels picker) | Exit cleanly. No files written. |
| Injection declined | Print file paths and a hint to launch manually. |
| Link expired / wrong password | Existing handling, unchanged. |
| Agent binary missing at spawn | Existing handling (exit 127). |

## Testing

`node:test` with the existing `FakePrompter` pattern from `handoff-builder.test.ts`.

- `distiller.test.ts` (new): fixtures for single-topic (no `topics` field) and 2-topic (with `topics` field and sub-headers) distillation. Tests `parseSections` and topic extraction.
- `formatter.test.ts` (extend): verifies `topics` rendering; single-topic output is byte-identical to current.
- `receiver-brief.test.ts` (new): scripted `FakePrompter`, mocked `fetch` for Gemini, asserted file paths for `<cwd>/.<agentId>/handoff.md` and `$TMPDIR/handoff-*.html`. Tests overwrite confirm, HTML open, injection prompt.
- `receiver-prompts.test.ts` (new): `RECEIVER_HTML_SCAFFOLD` contains Tailwind + Mermaid CDN tags and placeholders. `distillToHtmlAndMarkdown` mocked at the `fetch` boundary.
- `receive-command.test.ts` (new): end-to-end through `runReceive` with stubbed deps for transport, crypto, and distill.

Manual smoke: with `GEMINI_API_KEY` set, run `npm run dev -- receive <link>` against a real link and verify the HTML opens, the file lands in `.claude/`, and the spawned agent picks up the brief.

## Implementation Order

1. Rename: `export` → `send` (mechanical). Update `index.ts`, README.
2. Sender-side topic-aware distillation: prompt rewrite, transcript markers, `topics` field, formatter change. New `distiller.test.ts`. Extend `formatter.test.ts`.
3. New `src/core/receiver-prompts.ts` with `RECEIVER_SYSTEM_PROMPT`, `RECEIVER_HTML_SCAFFOLD`, `distillToHtmlAndMarkdown`. New `receiver-prompts.test.ts`.
4. New `src/core/receiver-brief.ts` with `ReceiverBriefDeps` (mirrors `HandoffBuilderDeps`). New `receiver-brief.test.ts`.
5. Refactor `src/commands/receive.ts` to a thin shell calling `core/receiver-brief.ts`. New `receive-command.test.ts`.
6. Manual smoke against a real link with `GEMINI_API_KEY` set.
