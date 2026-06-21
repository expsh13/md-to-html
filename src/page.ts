import type { Heading } from "./markdown.js";

type RenderPageOptions = {
  title: string;
  content: string;
  headings: Heading[];
};

export function renderPage({ title, content, headings }: RenderPageOptions): string {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/public/style.css">
</head>
<body>
  <aside class="toc">
    <div class="toc-title">${escapeHtml(title)}</div>
    <nav aria-label="Table of contents">
      ${renderToc(headings)}
    </nav>
  </aside>
  <div class="toc-resizer" aria-hidden="true"></div>
  <main>
    <div class="viewer-toolbar">
      <button class="mode-toggle" type="button" aria-pressed="false">編集</button>
      <span class="save-status" aria-live="polite"></span>
    </div>
    <textarea class="markdown-editor" spellcheck="false" hidden></textarea>
    <article>
      ${content}
    </article>
  </main>
  <script type="module" src="/public/app.js"></script>
</body>
</html>`;
}

export function renderToc(headings: Heading[]): string {
  const visibleHeadings = headings.filter((heading) => heading.level <= 3);

  if (visibleHeadings.length === 0) {
    return `<p class="toc-empty">No headings</p>`;
  }

  const items = visibleHeadings.map((heading) => {
    return `<li class="toc-item level-${heading.level}"><a href="#${heading.id}" data-heading-id="${heading.id}"><span class="toc-level">h${heading.level}</span>${escapeHtml(heading.text)}</a></li>`;
  });

  return `<ol class="toc-list">${items.join("")}</ol>`;
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
