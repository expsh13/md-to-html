import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";

export type Heading = {
  id: string;
  level: number;
  text: string;
};

type RenderMarkdownResult = {
  content: string;
  headings: Heading[];
};

const markdownRenderer = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
});

markdownRenderer.renderer.rules.heading_open = (tokens, index, options, _env, self) => {
  const token = tokens[index];
  const level = Number(token.tag.slice(1));
  const id = token.attrGet("id") ?? "";
  const text = token.meta?.headingText ?? "";
  const anchor = `<a class="heading-anchor" href="#${escapeAttribute(id)}" aria-label="Link to ${escapeAttribute(text)}">${"#".repeat(level)}</a>`;

  return self.renderToken(tokens, index, options) + anchor;
};

export function renderMarkdown(markdown: string): RenderMarkdownResult {
  const headings: Heading[] = [];
  const usedIds = new Map<string, number>();
  const tokens = markdownRenderer.parse(markdown, {});

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "heading_open") continue;

    const inlineToken = tokens[index + 1];
    const level = Number(token.tag.slice(1));
    const text = headingText(inlineToken).trim();
    const id = uniqueSlug(text, usedIds);

    token.attrSet("id", id);
    token.meta = { ...token.meta, headingText: text };
    headings.push({ id, level, text });
  }

  return {
    content: markdownRenderer.renderer.render(tokens, markdownRenderer.options, {}),
    headings,
  };
}

function headingText(token: Token | undefined): string {
  if (!token) return "";
  if (token.children) {
    return token.children.map(headingText).join("");
  }
  if (["text", "code_inline", "html_inline"].includes(token.type)) {
    return token.content;
  }
  return token.type === "image" ? token.content : "";
}

function uniqueSlug(text: string, usedIds: Map<string, number>): string {
  const base =
    text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "heading";
  const count = usedIds.get(base) ?? 0;
  usedIds.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
