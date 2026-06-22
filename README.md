<div align="center">

# send-context

**Hand off an AI coding-agent session to another developer through an encrypted, ephemeral link.**

[![npm version](https://img.shields.io/npm/v/send-context.svg)](https://www.npmjs.com/package/send-context)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/send-context.svg)](https://nodejs.org)

</div>

`send-context` moves live context between AI coding agents — across machines, across people, across tools. One developer exports their session; a teammate runs a single command to pick up exactly where they left off, with the context injected straight into _their_ agent.

The session is distilled into a structured **Context Handoff** document, encrypted on your machine, and stored behind a short-lived link. The transport layer only ever sees ciphertext.

## Contents

- [Why](#why)
- [Features](#features)
- [How it works](#how-it-works)
- [Getting started](#getting-started)
- [Usage](#usage)
- [Distill with Gemini](#distill-with-gemini)
- [Deploy the transport](#deploy-the-transport)
- [Supported agents](#supported-agents)
- [The Context Handoff document](#the-context-handoff-document)
- [Project structure](#project-structure)
- [Tech stack](#tech-stack)

## Why

Handing off work between agents usually means pasting a wall of chat history and hoping the next agent figures out what matters. That is noisy, leaks whatever was in the log, and lands the receiver in the same dead ends you already hit.

`send-context` extracts the session, distills it to what the next agent actually needs, encrypts it client-side, and gives you one link to share. The receiver decrypts locally and launches their own agent with the context already loaded.

## Features

- **Agent-agnostic** — works with pi, [Claude Code](https://claude.com/claude-code), and [OpenCode](https://opencode.ai) through a small adapter per agent.
- **Structured handoff** — sessions become a dense, six-section brief (objective, state, completed work, failed approaches, next steps, raw appendix) instead of raw chat logs.
- **Optional Gemini distillation** — point a `GEMINI_API_KEY` at it and the session is summarized automatically; without one, an interactive flow walks you through the brief.
- **Zero-knowledge transport** — AES-256-GCM encryption happens client-side; the server stores only encrypted blobs that expire after 24 hours.
- **Wrapper injection** — `receive <link> -- <agent> "prompt"` launches the receiver's own agent with the context pre-loaded.
- **No native dependencies** — pure TypeScript on Node's built-in `crypto`; installs cleanly on any OS.
- **Serverless backend** — a small Deno Deploy worker backed by Deno KV. No infrastructure to babysit.

## How it works

1. **Export** detects the active agent and extracts its session. With a `GEMINI_API_KEY` set, it distills the session into the handoff brief automatically; otherwise it guides you through writing the brief and choosing which raw messages to attach.
2. The brief is rendered into the Context Handoff template, encrypted with a password you choose, and uploaded. You get a `send-context://` link.
3. **Receive** downloads the blob, decrypts it locally, wraps it in an injection prompt, and spawns the receiving agent with that prompt as its opening message.

> [!NOTE]
> The password travels in the link fragment (`#…`), which is only ever processed client-side. Share the link over a channel you trust, or drop the fragment and share the password separately — `receive` will prompt for it.

## Getting started

### Prerequisites

- Node.js 20 or newer
- One of `pi`, `claude`, or `opencode`, with at least one session in the project directory
- A Google Gemini API key (optional) to auto-distill sessions — see [Distill with Gemini](#distill-with-gemini)
- [Deno](https://deno.com) (optional) only if you want to deploy or run the transport worker yourself

### Install

```bash
npm i -g send-context --registry=https://registry.npmjs.org/
send-context --help
```

> [!NOTE]
> The explicit `--registry` flag bypasses any private or proxy registry in your `~/.npmrc` that may not mirror the latest version. On a default npm setup, plain `npm i -g send-context` works too.

Or run it without installing:

```bash
npx send-context --help
```

<details>
<summary>From source</summary>

```bash
git clone https://github.com/shafiqimtiaz/context-handoff.git
cd context-handoff
npm install && npm run build
node dist/index.js --help
```

</details>

## Usage

### Send a context handoff

```bash
SEND_CONTEXT_WORKER=your-project.deno.net send-context export
# or pass the host and agent explicitly:
send-context export --worker your-project.deno.net --agent pi
```

Without a Gemini key, you are guided through choosing the agent, writing the brief, curating the appendix, and setting a password. The command prints a link:

```
send-context://your-project.deno.net/<id>#<password>
```

### Receive a context handoff

```bash
# Launch an agent with the context injected:
send-context receive 'send-context://…/<id>#<password>' -- pi "continue"
send-context receive 'send-context://…/<id>#<password>' -- claude "continue"
send-context receive 'send-context://…/<id>#<password>' -- opencode run "continue"

# Or just print the decrypted handoff document:
send-context receive 'send-context://…/<id>#<password>'
```

## Distill with Gemini

Raw sessions are noisy. Set `GEMINI_API_KEY` and `export` runs the session through Gemini first, distilling it into the five handoff sections and dropping the raw appendix — so the receiver gets a dense brief, not a chat log. The manual section and appendix prompts are skipped.

```bash
GEMINI_API_KEY=… SEND_CONTEXT_WORKER=your-project.deno.net send-context export
# optional: override the model (default gemini-2.5-flash)
GEMINI_MODEL=gemini-2.5-pro GEMINI_API_KEY=… send-context export
```

If the key is absent or the call fails, `export` falls back to the manual flow — Gemini is an enhancement, not a hard dependency. The key never leaves your machine; only the encrypted, distilled brief is uploaded, and it uses Google's OpenAI-compatible endpoint, so no extra SDK is installed.

Set `SEND_CONTEXT_PASSWORD` to skip the password prompt as well. With distillation on and a single detected agent, that makes `export` fully non-interactive — no TTY required:

```bash
GEMINI_API_KEY=… SEND_CONTEXT_PASSWORD=… \
  SEND_CONTEXT_WORKER=your-project.deno.net send-context export --agent pi
```

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `SEND_CONTEXT_WORKER` | yes (or `--worker`) | Transport worker host, e.g. `your-project.deno.net` |
| `GEMINI_API_KEY` | no | Enables automatic distillation |
| `GEMINI_MODEL` | no | Override the model (default `gemini-2.5-flash`) |
| `SEND_CONTEXT_PASSWORD` | no | Skip the interactive password prompt |

## Deploy the transport

The transport runs on **Deno Deploy + Deno KV** (`worker/main.ts`). It stores only encrypted payloads, each with a native 24-hour TTL.

**From GitHub (no local Deno needed):** push the repo, then create a project at [console.deno.com](https://console.deno.com) linked to it.

> [!IMPORTANT]
> Set **App Directory** to `worker` and **Entrypoint** to `main.ts`. If the app directory is left at the repository root, the build auto-detects the Node CLI in `src/` and fails. Leave install and build commands blank.

**From the CLI:**

```bash
deno install -gArf jsr:@deno/deployctl   # one-time
cd worker
deno task dev        # local test at http://localhost:8000
deno task deploy     # deploys --prod, prints your *.deno.net host
```

> [!WARNING]
> Deno KV caps each value at 64 KiB, so payloads are limited to about 60 KB. A curated handoff is far smaller; if you hit the limit, attach fewer appendix messages.

## Supported agents

| Agent | Extraction | Notes |
| --- | --- | --- |
| **OpenCode** | `opencode session list` + `opencode export <id>` | Uses the native session-export CLI. |
| **pi** | reads `~/.pi/agent/sessions/<project>/*.jsonl` | No stdout JSON dump exists; reads the documented session transcript. |
| **Claude Code** | reads `~/.claude/projects/<project>/*.jsonl` | Reads the documented JSONL transcript. |

> [!TIP]
> Adding a new agent is a single file implementing the `AgentAdapter` interface (`getName()` + `extractSession()`). Register it in `src/adapters/index.ts`.

## The Context Handoff document

Every export is formatted into a fixed Markdown structure, so the receiving model gets actionable context immediately:

1. **Primary Objective**
2. **Current State & Blockers**
3. **Completed Steps** — don't repeat these
4. **Failed Approaches** — don't retry these
5. **Next Steps** — start here
6. **Raw Context Appendix** — curated messages for deep context

## Project structure

```
src/
  index.ts            CLI entry (commander)
  core/
    crypto.ts         AES-256-GCM + scrypt
    distiller.ts      optional Gemini distillation
    link.ts           send-context:// codec
    transport.ts      upload/download client
    formatter.ts      Context Handoff renderer
    session-store.ts  JSONL helpers
    paths.ts exec.ts
  adapters/           pi, claude, opencode + registry
  commands/           export, receive
worker/
  main.ts             Deno Deploy + Deno KV worker
  deno.json
```

## Tech stack

- **CLI:** TypeScript, [commander](https://github.com/tj/commander.js), [@clack/prompts](https://github.com/bombshell-dev/clack)
- **Crypto:** Node.js built-in `crypto` (AES-256-GCM, scrypt)
- **Distillation (optional):** Google Gemini via its OpenAI-compatible Chat Completions endpoint, with [jsonrepair](https://github.com/josdejong/jsonrepair) for resilient parsing of model output
- **Transport:** Deno Deploy + Deno KV
