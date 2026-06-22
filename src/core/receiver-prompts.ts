import { AgentId } from "../adapters/index.js";

/**
 * Receiver-side Gemini generation. The receiver decrypts the sender's
 * verbose Markdown brief, then (when a key is set) calls Gemini to render
 * the brief as a self-contained HTML page for human review. When no key
 * is set, the receiver skips this step and writes the decrypted markdown
 * verbatim — graceful degrade.
 *
 * Same OpenAI-compatible endpoint as the sender side; no SDK.
 */
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

const DEFAULT_MODEL = "gemini-2.5-flash";

export const RECEIVER_SYSTEM_PROMPT = `You are rendering a verbose Markdown handoff brief as a complete HTML document for human review. Produce a single complete HTML document by filling in the body of the provided scaffold. Do not modify the scaffold's \`<!doctype html>\`, \`<html>\`, \`<head>\`, opening \`<body>\`, or closing \`</body></html>\` tags. Replace the \`<!-- CONTENT -->\` marker with rendered HTML.

Preservation rules:
- Preserve every word from the input Markdown verbatim. Do not paraphrase, summarize, or "tighten" the brief.
- Preserve all code fences, file paths, commands, error messages, and identifiers exactly as written.
- Preserve all heading levels and bullet structure.

Styling rules:
- The scaffold already provides all visual styling. Do not add inline styles, CSS classes, or \`<style>\` blocks.
- Use semantic HTML (\`<h1>\`, \`<h2>\`, \`<h3>\`, \`<p>\`, \`<ul>\`, \`<ol>\`, \`<li>\`, \`<pre>\`, \`<code>\`, \`<blockquote>\`, \`<table>\`, \`<hr>\`, \`<strong>\`, \`<em>\`, \`<a>\`). The scaffold styles these elements directly.
- Page frame: one column, max-width 48rem, warm-stone background (\`#fafaf7\`), serif title, sans body, monospace code, emerald accent (\`#047857\`), amber caution (\`#b45309\`).
- The first \`<h1>\` in the brief is the page title — leave it as-is; the scaffold styles it as the editorial title.
- Three bold metadata lines appear right after the \`<h1>\` (\`**Source Agent:** …\`, \`**Timestamp:** …\`, \`**Original Task:** …\`). Leave them as plain bold \`<p>\` paragraphs; the scaffold styles them as muted metadata.
- \`<h2>\` elements are section headers — leave them as-is; the scaffold renders them as small uppercase eyebrows with an emerald underline.
- The "Raw Context Appendix" section is long and noisy. Wrap its body content (the \`<h3>\` message labels and the \`<hr>\` separators) in \`<details><summary>Raw context (N messages)</summary>…</details>\` so it stays collapsed by default. Keep the \`<h2>\` "## Raw Context Appendix" itself outside the \`<details>\`.
- Inside the \`<details>\`, join consecutive messages with a single \`<hr>\` separator (do not add a leading or trailing \`<hr>\`).

Output the complete HTML document, starting with \`<!doctype html>\`. No JSON wrapper, no commentary.`;

/**
 * Editorial HTML scaffold for the receiver's HTML preview. Inline CSS only —
 * no Tailwind, no Mermaid, no external stylesheets, no fixed-section
 * placeholders. Gemini emits the body and the scaffold injects it at the
 * \`<!-- CONTENT -->\` marker; the CSS targets the semantic elements
 * Gemini produces (h1, h2, h3, p, ul, ol, pre, code, blockquote, table, hr,
 * strong, em, a, details, summary).
 *
 * Palette is the project's editorial stone/slate neutrals with an emerald
 * accent and amber caution — chosen to read well in print and on screen,
 * and to feel like a published document rather than a CLI dump.
 */
export const MINIMAL_HTML_SCAFFOLD = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Handoff Brief</title>
<style>
  /* ----------------------------------------------------------------------
     Editorial Handoff Brief — inline CSS, no external dependencies.
     Palette: warm stone neutrals, emerald accent, amber caution.
     Typography: serif title, sans body, monospace code.
     ---------------------------------------------------------------------- */

  :root {
    --bg: #fafaf7;             /* stone-50   — page background */
    --surface: #ffffff;        /* white      — cards, details panels */
    --surface-muted: #f5f5f4;  /* stone-100  — table heads, summary bars */
    --border: #e7e5e4;         /* stone-200  — default dividers */
    --border-strong: #d6d3d1;  /* stone-300  — h1 underline */
    --text: #1c1917;           /* stone-900  — primary text */
    --text-muted: #57534e;     /* stone-600  — metadata, captions */
    --text-faint: #a8a29e;     /* stone-400  — list markers, faint lines */
    --accent: #047857;         /* emerald-700 — h2 eyebrows, links, focus */
    --accent-soft: #ecfdf5;    /* emerald-50  — blockquote wash */
    --accent-line: #a7f3d0;    /* emerald-200 — h2 underline, link border */
    --warn: #b45309;           /* amber-700   — caution callouts */
    --warn-soft: #fffbeb;      /* amber-50    — caution wash */
    --warn-line: #fde68a;      /* amber-200   — caution border */
    --code-bg: #1c1917;        /* stone-900   — code block background */
    --code-text: #f5f5f4;      /* stone-100   — code block text */
  }

  *, *::before, *::after { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 16px;
    line-height: 1.7;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: optimizeLegibility;
  }

  main {
    max-width: 48rem;
    margin: 0 auto;
    padding: 3.5rem 1.5rem 6rem;
  }

  /* H1: page title — serif, tight, with a stone underline */
  h1 {
    font-family: ui-serif, "Iowan Old Style", "Apple Garamond", Baskerville, Georgia, "Times New Roman", serif;
    font-size: 2.5rem;
    font-weight: 600;
    line-height: 1.15;
    letter-spacing: -0.02em;
    color: var(--text);
    margin: 0 0 0.25rem;
    padding: 0 0 1.25rem;
    border-bottom: 1px solid var(--border-strong);
  }

  /* H2: section header — small uppercase eyebrow, emerald underline */
  h2 {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--accent);
    margin: 3.25rem 0 1.25rem;
    padding: 0 0 0.5rem;
    border-bottom: 1px solid var(--accent-line);
  }

  /* H3: subsection */
  h3 {
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--text);
    margin: 1.75rem 0 0.6rem;
    line-height: 1.4;
  }

  /* Body */
  p { margin: 0 0 1rem; }

  /* Metadata block (the three bold lines right after the h1) */
  h1 + p,
  h1 + p + p,
  h1 + p + p + p {
    color: var(--text-muted);
    font-size: 0.95rem;
    margin: 0.2rem 0;
    line-height: 1.55;
  }
  h1 + p strong,
  h1 + p + p strong,
  h1 + p + p + p strong {
    color: var(--text);
    font-weight: 600;
  }

  /* Lists */
  ul, ol { margin: 0 0 1rem; padding-left: 1.5rem; }
  li { margin: 0.35rem 0; }
  li::marker { color: var(--text-faint); }
  ul ul, ol ol, ul ol, ol ul { margin: 0.25rem 0; }

  /* Inline code */
  code {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.875em;
    background: var(--surface-muted);
    padding: 0.1em 0.35em;
    border-radius: 4px;
    border: 1px solid var(--border);
  }

  /* Code blocks */
  pre {
    background: var(--code-bg);
    color: var(--code-text);
    padding: 1rem 1.25rem;
    border-radius: 8px;
    overflow-x: auto;
    line-height: 1.55;
    margin: 0 0 1.25rem;
    font-size: 0.9rem;
  }
  pre code {
    background: none;
    padding: 0;
    border: none;
    font-size: inherit;
    color: inherit;
  }

  /* Blockquote — emerald left bar, emerald-50 wash */
  blockquote {
    margin: 1.25rem 0;
    padding: 0.75rem 1.25rem;
    border-left: 3px solid var(--accent);
    background: var(--accent-soft);
    border-radius: 0 6px 6px 0;
  }
  blockquote p { margin: 0.4rem 0; }
  blockquote p:last-child { margin-bottom: 0; }

  /* Horizontal rule */
  hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 2rem 0;
  }

  /* Tables */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 0 0 1.25rem;
    font-size: 0.92rem;
  }
  th, td {
    text-align: left;
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid var(--border);
  }
  th {
    font-weight: 600;
    color: var(--text-muted);
    background: var(--surface-muted);
  }

  /* Details/summary — used for the raw appendix */
  details {
    margin: 0 0 1.25rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    overflow: hidden;
  }
  details summary {
    cursor: pointer;
    padding: 0.85rem 1.1rem;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
    background: var(--surface-muted);
    list-style: none;
    user-select: none;
  }
  details summary::-webkit-details-marker { display: none; }
  details[open] summary { border-bottom: 1px solid var(--border); }
  details > *:not(summary) { padding: 0.5rem 1.1rem; }
  details h3:not(:first-child) { margin-top: 0; }

  /* Links */
  a {
    color: var(--accent);
    text-decoration: none;
    border-bottom: 1px solid var(--accent-line);
  }
  a:hover { border-bottom-color: var(--accent); }

  /* Strong */
  strong { font-weight: 600; color: var(--text); }

  /* Selection */
  ::selection { background: var(--accent-line); color: var(--text); }

  /* Print */
  @media print {
    body { background: white; color: black; }
    main { max-width: none; padding: 0; }
    h2, h3 { break-after: avoid; }
    pre, blockquote, details { break-inside: avoid; }
    details[open] { break-inside: avoid; }
  }
</style>
</head>
<body>
<main>
<!-- CONTENT -->
</main>
</body>
</html>
`;

export function receiverGeminiAvailable(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export interface DistillResult {
  /** The brief passed through verbatim — no Gemini transformation. */
  markdown: string;
  /** Complete HTML document with the brief's body injected into the minimal scaffold. */
  html: string;
}

/**
 * Extract the inner content of the outermost `<main>` (or `<body>` as a
 * fallback) from a complete HTML document. Returns null if neither tag is
 * present.
 */
export function extractMainContent(html: string): string | null {
  const mainMatch = matchOutermostTag(html, "main");
  if (mainMatch) return mainMatch;
  const bodyMatch = matchOutermostTag(html, "body");
  if (bodyMatch) return bodyMatch;
  return null;
}

function matchOutermostTag(html: string, tag: string): string | null {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  const start = html.toLowerCase().indexOf(open.toLowerCase());
  if (start === -1) return null;
  // Find the end of the opening tag.
  const openEnd = html.indexOf(">", start);
  if (openEnd === -1) return null;
  // Find the matching close tag at the same depth.
  const searchFrom = openEnd + 1;
  let depth = 1;
  let cursor = searchFrom;
  const tagRe = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
  tagRe.lastIndex = cursor;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const isClose = m[0].startsWith(`</`);
    if (isClose) {
      depth--;
      if (depth === 0) {
        return html.slice(searchFrom, m.index);
      }
    } else {
      // Skip self-closing tags like <main /> (no body content).
      if (!m[0].endsWith("/>")) depth++;
    }
    cursor = m.index + m[0].length;
  }
  return null;
}

/**
 * Replace the `<!-- CONTENT -->` marker in the scaffold with the body HTML.
 */
export function injectIntoScaffold(scaffold: string, body: string): string {
  return scaffold.replace(/<!--\s*CONTENT\s*-->/, body);
}

/**
 * Render a verbose Markdown brief as a self-contained HTML page. Calls
 * Gemini, extracts the `<main>` body from its output, and injects that
 * body into the minimal scaffold so the page styling is always ours.
 *
 * On any Gemini-side failure, throws — the caller (receiver-brief) falls
 * back to the verbatim brief.
 */
export async function distillToHtmlAndMarkdown(
  brief: string,
  _agentId: AgentId,
): Promise<DistillResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set.");
  const model = process.env.GEMINI_MODEL ?? DEFAULT_MODEL;

  const res = await fetch(GEMINI_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: RECEIVER_SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `Render the following Markdown brief as HTML using the minimal scaffold provided. ` +
            `Output the complete \`<!doctype html>\` document.\n\n` +
            `---\n\n` +
            `MINIMAL SCAFFOLD (use as the base; replace the <!-- CONTENT --> marker):\n\n` +
            MINIMAL_HTML_SCAFFOLD +
            `\n\n---\n\n` +
            `BRIEF:\n\n${brief}\n`,
        },
      ],
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

  const body = extractMainContent(content);
  const html = body !== null ? injectIntoScaffold(MINIMAL_HTML_SCAFFOLD, body) : content;

  return { markdown: brief, html };
}
