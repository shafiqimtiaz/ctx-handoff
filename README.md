# handoff

Agent-agnostic CLI that relays an AI coding-agent session from one developer to
another via an **encrypted, ephemeral edge link**. The sender exports their
session into a structured *Handoff Skill* document, encrypts it client-side, and
shares a `handoff://` link. The receiver downloads, decrypts, and injects the
context straight into their own agent.

Supported agents: **pi**, **Claude Code**, **OpenCode**.

## Install

```bash
npm install
npm run build      # compiles to ./dist
node dist/index.js --help
```

## Deploy the transport worker

The transport is a Cloudflare Worker backed by KV (zero-knowledge: it only ever
stores encrypted blobs, 24h TTL).

```bash
cd worker
npm install
npx wrangler kv namespace create HANDOFF_KV   # paste the id into wrangler.toml
npx wrangler deploy                            # prints your worker host
```

## Usage

### Sender

```bash
HANDOFF_WORKER=handoff.you.workers.dev node dist/index.js export
# or:  node dist/index.js export --worker handoff.you.workers.dev --agent pi
```

You'll be guided to: pick the agent (auto-detected), optionally write the
objective / blockers / next steps, curate which raw messages to attach, and set
a password. It prints a link:

```
handoff://handoff.you.workers.dev/<id>#<password>
```

### Receiver

```bash
node dist/index.js receive 'handoff://.../<id>#<password>' -- pi "continue"
```

The CLI downloads, decrypts, builds the injection prompt, and launches the agent
(`pi`, `claude`, `opencode`, …) with the context as its initial prompt. Omit the
`-- <agent> …` part to just print the handoff document.

## The Handoff Skill Standard

Every export is formatted into a fixed 6-section Markdown document (Objective,
Current State & Blockers, Completed Steps, Failed Approaches, Next Steps, Raw
Context Appendix) so the receiving LLM gets dense, actionable context.

## Architecture notes / deviations from the original spec

- **Crypto:** AES-256-GCM with a scrypt-derived key over a **random per-payload
  salt** (the spec implied a fixed-salt `{iv, ciphertext}`; a random salt is
  carried in the payload and is strictly more secure). Wrong password fails the
  GCM auth-tag check.
- **Session extraction — CLI vs. files.** The spec mandated shelling out to each
  agent's CLI (`pi --print --format json`, `claude export`). In reality:
  - **OpenCode** *does* expose a JSON session export — its adapter uses
    `opencode session list` + `opencode export <id>` exactly as intended.
  - **pi** and **Claude Code** have **no command that dumps a session as JSON to
    stdout** (`pi --mode json` starts a *new* model turn; `pi --export` only
    writes HTML). Their session transcripts are documented JSONL files
    (`~/.pi/agent/sessions/…` and `~/.claude/projects/…`). Those adapters read
    that documented JSONL. This is the only viable path; the `AgentAdapter`
    interface is unchanged, so a true CLI-based adapter can drop in later.
- **Zero native dependencies:** only `commander` + `@clack/prompts`; crypto is
  Node's built-in module.
