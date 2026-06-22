import { spawn } from "node:child_process";
import * as p from "@clack/prompts";
import { decodeLink } from "../core/link.js";
import { downloadPayload } from "../core/transport.js";
import { decrypt } from "../core/crypto.js";

const INJECTION_PREAMBLE = `SYSTEM CONTEXT INJECTION:
You are resuming a task. You have been provided with an Context Handoff Document.
Read it carefully. Do not repeat "Completed Steps". Avoid "Failed Approaches".
Acknowledge the "Current State" and immediately begin working on the "Next Steps".`;

export async function runReceive(rawLink: string, agentArgv: string[]): Promise<void> {
  p.intro("ctx-handoff receive");

  // commander hands us the literal "--" separator as the first token; drop it.
  if (agentArgv[0] === "--") agentArgv = agentArgv.slice(1);

  let link;
  try {
    link = decodeLink(rawLink);
  } catch (err) {
    p.cancel(String((err as Error).message));
    process.exitCode = 1;
    return;
  }

  const spin = p.spinner();
  spin.start("Downloading handoff");
  let payload;
  try {
    payload = await downloadPayload(link.workerHost, link.id);
  } catch (err) {
    spin.stop("Download failed.");
    const msg = (err as Error).message;
    p.cancel(msg === "LINK_EXPIRED" ? "Link expired or invalid." : msg);
    process.exitCode = 1;
    return;
  }
  spin.stop("Downloaded.");

  const password = await p.password({ message: "Password:" });
  if (p.isCancel(password)) {
    p.cancel("Cancelled.");
    process.exitCode = 130;
    return;
  }

  let markdown: string;
  try {
    markdown = decrypt(payload, password);
  } catch (err) {
    const msg = (err as Error).message;
    p.cancel(msg === "INVALID_PASSWORD" ? "Invalid password." : msg);
    process.exitCode = 1;
    return;
  }

  if (agentArgv.length === 0) {
    // No agent to launch — just print the handoff document.
    p.outro("No agent command given; printing handoff document below.");
    process.stdout.write(`\n${markdown}\n`);
    return;
  }

  const [bin, ...rest] = agentArgv;
  const userRequest = extractUserRequest(rest);
  const injection = `${INJECTION_PREAMBLE}\n\n${markdown}\n\nUSER REQUEST:\n${userRequest}`;

  p.outro(`Launching ${bin} with injected context…`);
  await launchAgent(bin, rest, injection);
}

/**
 * The trailing free-text in the agent args is treated as the user's request so
 * it can be merged into the injection prompt. We pass the whole thing as the
 * final positional argument to the agent CLI (the wrapper pattern), so the
 * receiver interacts with their agent normally.
 */
function extractUserRequest(rest: string[]): string {
  const positional = rest.filter((a) => !a.startsWith("-"));
  return positional.join(" ") || "Continue the work described above.";
}

function launchAgent(bin: string, rest: string[], injection: string): Promise<void> {
  // Replace the trailing positional prompt (if any) with the full injection;
  // keep any flags the user passed before it.
  const flags = rest.filter((a) => a.startsWith("-"));
  const args = [...flags, injection];

  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: "inherit" });
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        process.stderr.write(
          `\nAgent '${bin}' not found. Is it installed and in your PATH?\n`,
        );
        process.exitCode = 127;
      } else {
        process.stderr.write(`\nFailed to launch '${bin}': ${err.message}\n`);
        process.exitCode = 1;
      }
      resolve();
    });
    child.on("close", (code) => {
      process.exitCode = code ?? 0;
      resolve();
    });
  });
}
