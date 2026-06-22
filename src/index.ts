#!/usr/bin/env node
import { Command } from "commander";
import { runExport, ExportOptions } from "./commands/export.js";
import { runReceive } from "./commands/receive.js";
import { AgentId } from "./adapters/index.js";

const program = new Command();

program
  .name("handoff")
  .description("Relay AI coding-agent session context between developers via an encrypted, ephemeral link.")
  .version("0.1.0")
  .enablePositionalOptions();

program
  .command("export")
  .description("Extract the current agent session, format it, encrypt it, and produce a share link.")
  .option("-a, --agent <agent>", "force agent: pi | claude | opencode")
  .option("-w, --worker <host>", "Cloudflare Worker host (or set HANDOFF_WORKER)")
  .action((opts: { agent?: string; worker?: string }) =>
    runExport({ agent: opts.agent as AgentId | undefined, worker: opts.worker } as ExportOptions),
  );

program
  .command("receive")
  .description("Download and decrypt a handoff, then launch an agent with the context injected.")
  .argument("<link>", "handoff:// link")
  .argument("[agent...]", "agent command to launch after --, e.g. -- pi \"continue\"")
  .allowUnknownOption()
  .passThroughOptions()
  .action((link: string, agent: string[]) => runReceive(link, agent ?? []));

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
