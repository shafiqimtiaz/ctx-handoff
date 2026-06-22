import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Centralized platform paths for agent session stores. Keeping these in one
 * place means a new agent layout only changes here.
 */
export const PI_SESSIONS_ROOT = join(homedir(), ".pi", "agent", "sessions");
export const CLAUDE_PROJECTS_ROOT = join(homedir(), ".claude", "projects");

/**
 * pi encodes the project directory as a session-store folder name:
 *   /home/x/Documents/proj  ->  --home-x-Documents-proj--
 * (slashes become dashes, the result is wrapped in leading/trailing dashes).
 */
export function piSlug(cwd: string): string {
  return `-${cwd.replace(/\//g, "-")}--`;
}

/**
 * Claude Code encodes the project directory as a project folder name by
 * replacing every non-alphanumeric character with a dash:
 *   /home/x/Documents/proj  ->  -home-x-Documents-proj
 */
export function claudeSlug(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}
