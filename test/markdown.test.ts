import { expect, test } from "vite-plus/test";

import { renderMarkdown } from "../src/markdown.ts";

test("extracts headings and renders heading anchors", () => {
  const result = renderMarkdown(`# Title

## Section

### Detail`);

  expect(result.headings.map(({ level, text }) => ({ level, text }))).toEqual([
    { level: 1, text: "Title" },
    { level: 2, text: "Section" },
    { level: 3, text: "Detail" },
  ]);
  expect(result.content).toMatch(/<a class="heading-anchor"[^>]*>#<\/a>Title/);
  expect(result.content).toMatch(/<a class="heading-anchor"[^>]*>##<\/a>Section/);
  expect(result.content).toMatch(/<a class="heading-anchor"[^>]*>###<\/a>Detail/);
});

test("keeps duplicate heading ids unique", () => {
  const result = renderMarkdown(`## Same

## Same`);

  expect(result.headings.map((heading) => heading.id)).toEqual(["same", "same-2"]);
});

test("extracts heading text from inline markdown", () => {
  const result = renderMarkdown("## **Bold** `Code` [Link](https://example.com)");

  expect(result.headings).toEqual([
    {
      id: "bold-code-link",
      level: 2,
      text: "Bold Code Link",
    },
  ]);
});

test("renders common markdown blocks through markdown-it", () => {
  const result = renderMarkdown(`| Name | Value |
| --- | --- |
| A | 1 |

\`\`\`ts
const value = 1;
\`\`\`

![Alt text](./assets/sample-image.svg)`);

  expect(result.content).toContain("<table>");
  expect(result.content).toContain('<code class="language-ts">');
  expect(result.content).toContain('<img src="./assets/sample-image.svg" alt="Alt text">');
});
