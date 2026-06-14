import assert from "node:assert/strict";
import test from "node:test";

import { renderMarkdown } from "../src/server.ts";

test("extracts headings and renders heading anchors", () => {
  const result = renderMarkdown(`# Title

## Section

### Detail`);

  assert.deepEqual(result.headings.map(({ level, text }) => ({ level, text })), [
    { level: 1, text: "Title" },
    { level: 2, text: "Section" },
    { level: 3, text: "Detail" }
  ]);
  assert.match(result.content, /<a class="heading-anchor"[^>]*>#<\/a>Title/);
  assert.match(result.content, /<a class="heading-anchor"[^>]*>##<\/a>Section/);
  assert.match(result.content, /<a class="heading-anchor"[^>]*>###<\/a>Detail/);
});

test("keeps duplicate heading ids unique", () => {
  const result = renderMarkdown(`## Same

## Same`);

  assert.deepEqual(result.headings.map((heading) => heading.id), ["same", "same-2"]);
});
