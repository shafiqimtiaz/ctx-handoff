import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MINIMAL_HTML_SCAFFOLD,
  RECEIVER_SYSTEM_PROMPT,
  distillToHtmlAndMarkdown,
  extractMainContent,
  injectIntoScaffold,
} from "./receiver-prompts.js";

// ----- MINIMAL_HTML_SCAFFOLD shape ---------------------------------------

test("MINIMAL_HTML_SCAFFOLD: starts with <!doctype html>", () => {
  assert.match(MINIMAL_HTML_SCAFFOLD, /^<!doctype html>/i);
});

test("MINIMAL_HTML_SCAFFOLD: contains inline <style> block (no external CSS deps)", () => {
  assert.match(MINIMAL_HTML_SCAFFOLD, /<style>/);
  // No <link rel="stylesheet" href="..."> to external CSS.
  assert.doesNotMatch(MINIMAL_HTML_SCAFFOLD, /<link[^>]+rel=["']stylesheet["']/);
});

test("MINIMAL_HTML_SCAFFOLD: contains no Tailwind CDN", () => {
  assert.doesNotMatch(MINIMAL_HTML_SCAFFOLD, /cdn\.tailwindcss\.com/i);
});

test("MINIMAL_HTML_SCAFFOLD: contains no Mermaid CDN", () => {
  assert.doesNotMatch(MINIMAL_HTML_SCAFFOLD, /mermaid/i);
});

test("MINIMAL_HTML_SCAFFOLD: contains no fixed-section placeholders", () => {
  // Old scaffold had {{objective_body}}, {{current_state_body}}, etc.
  for (const placeholder of [
    "objective_body",
    "current_state_body",
    "completed_steps_body",
    "failed_approaches_body",
    "next_steps_body",
    "raw_appendix_body",
    "topic_chips",
  ]) {
    assert.doesNotMatch(
      MINIMAL_HTML_SCAFFOLD,
      new RegExp(`\\{\\{${placeholder}\\}\\}`),
      `scaffold should not contain {{${placeholder}}}`,
    );
  }
});

test("MINIMAL_HTML_SCAFFOLD: contains a <!-- CONTENT --> marker for body injection", () => {
  assert.match(MINIMAL_HTML_SCAFFOLD, /<!--\s*CONTENT\s*-->/);
});

test("MINIMAL_HTML_SCAFFOLD: defines a comfortable max-width for the main column", () => {
  // The max-width is set in the <style> block, not as an inline attribute.
  assert.match(MINIMAL_HTML_SCAFFOLD, /max-width:\s*48rem/);
});

// ----- MINIMAL_HTML_SCAFFOLD design palette -------------------------------

test("MINIMAL_HTML_SCAFFOLD: declares the editorial color palette as CSS custom properties", () => {
  // The palette is a set of named tokens, not raw hex scattered through
  // selectors — that way future tweaks happen in one place.
  for (const token of [
    "--bg", "--surface", "--surface-muted",
    "--border", "--border-strong",
    "--text", "--text-muted", "--text-faint",
    "--accent", "--accent-soft", "--accent-line",
    "--warn", "--warn-soft", "--warn-line",
    "--code-bg", "--code-text",
  ]) {
    assert.match(
      MINIMAL_HTML_SCAFFOLD,
      new RegExp(`${token}\\s*:`),
      `scaffold should declare the ${token} design token`,
    );
  }
});

test("MINIMAL_HTML_SCAFFOLD: emerald accent drives h2 eyebrows and links", () => {
  // emerald-700 family — h2 color and link color share it.
  assert.match(MINIMAL_HTML_SCAFFOLD, /h2[^}]*color:\s*var\(--accent\)/);
  assert.match(MINIMAL_HTML_SCAFFOLD, /a[^}]*color:\s*var\(--accent\)/);
});

test("MINIMAL_HTML_SCAFFOLD: amber caution tokens are present for callouts and warnings", () => {
  assert.match(MINIMAL_HTML_SCAFFOLD, /--warn\s*:\s*#b45309/);   // amber-700
  assert.match(MINIMAL_HTML_SCAFFOLD, /--warn-soft\s*:\s*#fffbeb/); // amber-50
});

test("MINIMAL_HTML_SCAFFOLD: h1 uses a serif font stack", () => {
  assert.match(MINIMAL_HTML_SCAFFOLD, /h1[^}]*font-family:[^;}]*serif/i);
});

test("MINIMAL_HTML_SCAFFOLD: h2 is rendered as a small uppercase eyebrow with an accent underline", () => {
  assert.match(MINIMAL_HTML_SCAFFOLD, /h2[^}]*text-transform:\s*uppercase/);
  assert.match(MINIMAL_HTML_SCAFFOLD, /h2[^}]*letter-spacing:/);
  assert.match(MINIMAL_HTML_SCAFFOLD, /h2[^}]*border-bottom:[^;}]*var\(--accent-line\)/);
});

test("MINIMAL_HTML_SCAFFOLD: code blocks use the dark surface token", () => {
  assert.match(MINIMAL_HTML_SCAFFOLD, /pre[^}]*background:\s*var\(--code-bg\)/);
  assert.match(MINIMAL_HTML_SCAFFOLD, /pre[^}]*color:\s*var\(--code-text\)/);
});

test("MINIMAL_HTML_SCAFFOLD: blockquote uses the emerald accent for its left bar", () => {
  assert.match(MINIMAL_HTML_SCAFFOLD, /blockquote[^}]*border-left:[^;}]*var\(--accent\)/);
  assert.match(MINIMAL_HTML_SCAFFOLD, /blockquote[^}]*background:\s*var\(--accent-soft\)/);
});

test("MINIMAL_HTML_SCAFFOLD: details/summary are styled for the collapsed raw appendix", () => {
  // The details panel has rounded corners and a stone border; the summary
  // bar is a stone-100 surface with uppercase eyebrow text.
  assert.match(MINIMAL_HTML_SCAFFOLD, /details[^}]*border:\s*1px\s+solid\s+var\(--border\)/);
  assert.match(MINIMAL_HTML_SCAFFOLD, /details summary[^}]*background:\s*var\(--surface-muted\)/);
  assert.match(MINIMAL_HTML_SCAFFOLD, /details summary[^}]*text-transform:\s*uppercase/);
});

test("MINIMAL_HTML_SCAFFOLD: applies a print stylesheet so the brief prints cleanly", () => {
  assert.match(MINIMAL_HTML_SCAFFOLD, /@media\s+print/);
});

// ----- RECEIVER_SYSTEM_PROMPT contract -----------------------------------

test("RECEIVER_SYSTEM_PROMPT: does not request JSON output", () => {
  assert.doesNotMatch(RECEIVER_SYSTEM_PROMPT, /response_format/);
  assert.doesNotMatch(RECEIVER_SYSTEM_PROMPT, /json_object/);
  assert.doesNotMatch(RECEIVER_SYSTEM_PROMPT, /JSON object/i);
});

test("RECEIVER_SYSTEM_PROMPT: instructs the model to produce a complete HTML document", () => {
  assert.match(RECEIVER_SYSTEM_PROMPT, /<!doctype html>/i);
  assert.match(RECEIVER_SYSTEM_PROMPT, /complete\s+html\s+document/i);
});

test("RECEIVER_SYSTEM_PROMPT: requires verbatim preservation of the input markdown", () => {
  assert.match(RECEIVER_SYSTEM_PROMPT, /preserve\s+every\s+word/i);
  assert.match(RECEIVER_SYSTEM_PROMPT, /verbatim/i);
});

test("RECEIVER_SYSTEM_PROMPT: tells the model to use semantic HTML and let the scaffold style it", () => {
  // The prompt is design-aware: it points at the scaffold's styling and
  // forbids inline styles / extra <style> blocks / extra CSS classes.
  assert.match(RECEIVER_SYSTEM_PROMPT, /semantic html/i);
  assert.match(RECEIVER_SYSTEM_PROMPT, /do not add inline styles/i);
  assert.match(RECEIVER_SYSTEM_PROMPT, /<style>/);
});

test("RECEIVER_SYSTEM_PROMPT: tells the model to collapse the raw appendix in <details>", () => {
  // The appendix is long; the brief is more scannable with it collapsed.
  assert.match(RECEIVER_SYSTEM_PROMPT, /<details>/i);
  assert.match(RECEIVER_SYSTEM_PROMPT, /raw context appendix/i);
});

// ----- extractMainContent ------------------------------------------------

test("extractMainContent: returns inner content of <main> when present", () => {
  const html = "<!doctype html><html><body><main><h1>hi</h1></main></body></html>";
  assert.equal(extractMainContent(html), "<h1>hi</h1>");
});

test("extractMainContent: returns body inner content when no <main>", () => {
  const html = "<!doctype html><html><body><h1>hi</h1></body></html>";
  assert.equal(extractMainContent(html), "<h1>hi</h1>");
});

test("extractMainContent: returns null when neither <main> nor <body> is present", () => {
  assert.equal(extractMainContent("just a fragment"), null);
});

test("extractMainContent: handles nested <main> correctly (inner of outermost)", () => {
  const html = "<main>outer<main>inner</main>tail</main>";
  assert.equal(extractMainContent(html), "outer<main>inner</main>tail");
});

// ----- injectIntoScaffold -----------------------------------------------

test("injectIntoScaffold: replaces <!-- CONTENT --> marker with body", () => {
  const result = injectIntoScaffold("before<!-- CONTENT -->after", "PAYLOAD");
  assert.equal(result, "beforePAYLOADafter");
});

test("injectIntoScaffold: preserves scaffold structure around the injection", () => {
  const scaffold = "<!doctype html><body><main><!-- CONTENT --></main></body>";
  const result = injectIntoScaffold(scaffold, "<h1>brief</h1>");
  assert.match(result, /<!doctype html>/);
  assert.match(result, /<h1>brief<\/h1>/);
  assert.match(result, /<main><h1>brief<\/h1><\/main>/);
});

// ----- distillToHtmlAndMarkdown -----------------------------------------

test("distillToHtmlAndMarkdown: throws when GEMINI_API_KEY is missing", async () => {
  delete process.env.GEMINI_API_KEY;
  await assert.rejects(
    () => distillToHtmlAndMarkdown("# Brief", "pi"),
    /GEMINI_API_KEY/,
  );
});

test("distillToHtmlAndMarkdown: returns the input brief verbatim as markdown", async () => {
  const originalFetch = globalThis.fetch;
  const brief = "# Handoff Brief: foo\n\n## Current State\n\n`src/core/distiller.ts` line 42.\n";
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "<!doctype html><body><main><h1>Handoff Brief: foo</h1></main></body>",
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;
  process.env.GEMINI_API_KEY = "test-key";

  try {
    const out = await distillToHtmlAndMarkdown(brief, "pi");
    assert.equal(out.markdown, brief, "markdown is the verbatim input brief");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GEMINI_API_KEY;
  }
});

test("distillToHtmlAndMarkdown: extracts <main> body from Gemini's HTML and injects into scaffold", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                "<!doctype html><html><body><main><h1>Brief</h1><p>body</p></main></body></html>",
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;
  process.env.GEMINI_API_KEY = "test-key";

  try {
    const out = await distillToHtmlAndMarkdown("# Brief", "pi");
    // The Gemini <main> body is injected into the scaffold's <!-- CONTENT --> marker.
    assert.match(out.html, /<h1>Brief<\/h1><p>body<\/p>/);
    // The scaffold's styling is preserved (no Tailwind CDN).
    assert.doesNotMatch(out.html, /cdn\.tailwindcss\.com/i);
    assert.match(out.html, /^<!doctype html>/i);
    // The original <!-- CONTENT --> marker is gone.
    assert.doesNotMatch(out.html, /<!--\s*CONTENT\s*-->/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GEMINI_API_KEY;
  }
});

test("distillToHtmlAndMarkdown: falls back to Gemini's full output when no <main> or <body> found", async () => {
  const originalFetch = globalThis.fetch;
  const fallback = "<!doctype html><h1>bare html</h1>";
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: fallback } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;
  process.env.GEMINI_API_KEY = "test-key";

  try {
    const out = await distillToHtmlAndMarkdown("# Brief", "pi");
    assert.equal(out.html, fallback);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GEMINI_API_KEY;
  }
});

test("distillToHtmlAndMarkdown: throws on non-OK response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("rate limited", { status: 429 })) as typeof fetch;
  process.env.GEMINI_API_KEY = "test-key";

  try {
    await assert.rejects(
      () => distillToHtmlAndMarkdown("# Brief", "pi"),
      /Gemini request failed \(429\)/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GEMINI_API_KEY;
  }
});

test("distillToHtmlAndMarkdown: does NOT use response_format: json_object", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> | null = null;
  globalThis.fetch = (async (_url: unknown, init: unknown) => {
    capturedBody = JSON.parse((init as RequestInit).body as string);
    return new Response(
      JSON.stringify({
        choices: [
          { message: { content: "<!doctype html><body><main>x</main></body>" } },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  process.env.GEMINI_API_KEY = "test-key";

  try {
    await distillToHtmlAndMarkdown("# Brief", "pi");
    assert.equal(capturedBody?.response_format, undefined, "no JSON response_format");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GEMINI_API_KEY;
  }
});
