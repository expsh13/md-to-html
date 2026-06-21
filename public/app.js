const resizer = document.querySelector(".toc-resizer");
const visibleHeadingLevels = new Set(["H1", "H2", "H3"]);
const headingStorageKey = "md-to-html-heading-id";

try {
  history.scrollRestoration = "manual";
} catch {
  // Ignore unsupported browsers.
}

const reloadEvents = new EventSource("/events");
reloadEvents.addEventListener("reload", () => {
  if (document.body.classList.contains("editing")) return;
  reloadWithHeadingRestoration();
});

let isResizingToc = false;
let savedTocWidth = null;
let isEditing = false;
let saveTimer = null;
let latestSave = Promise.resolve();
let currentHeadingId = null;
let transitionHeadingId = null;
let isProgrammaticScroll = false;
let programmaticScrollTimer = null;
let allHeadings = [];
let activeHeadings = [];

const article = document.querySelector("article");
const editor = document.querySelector(".markdown-editor");
const modeToggle = document.querySelector(".mode-toggle");
const saveStatus = document.querySelector(".save-status");
const tocNav = document.querySelector(".toc nav");

try {
  savedTocWidth = localStorage.getItem("toc-width");
} catch {
  savedTocWidth = null;
}

if (savedTocWidth) {
  applyTocWidth(Number(savedTocWidth));
}

function applyTocWidth(clientX) {
  const width = Math.min(Math.max(clientX, 0), 520);
  document.documentElement.style.setProperty("--toc-width", width + "px");
  document.body.classList.toggle("toc-closed", width <= 16);
  try {
    localStorage.setItem("toc-width", String(width));
  } catch {
    // Ignore storage failures; resizing still works for the current page.
  }
}

function startTocResize(event) {
  event.preventDefault();
  isResizingToc = true;
  document.body.classList.add("resizing-toc");
  if (event.pointerId !== undefined) {
    resizer.setPointerCapture(event.pointerId);
  }
}

function moveTocResize(event) {
  if (!isResizingToc) return;
  applyTocWidth(event.clientX);
}

function stopTocResize(event) {
  if (!isResizingToc) return;
  isResizingToc = false;
  document.body.classList.remove("resizing-toc");
  if (event.pointerId !== undefined && resizer.hasPointerCapture(event.pointerId)) {
    resizer.releasePointerCapture(event.pointerId);
  }
}

resizer?.addEventListener("pointerdown", startTocResize);
resizer?.addEventListener("mousedown", startTocResize);
window.addEventListener("pointermove", moveTocResize);
window.addEventListener("mousemove", moveTocResize);
window.addEventListener("pointerup", stopTocResize);
window.addEventListener("mouseup", stopTocResize);

function setActive(id) {
  document.querySelectorAll(".toc .active, .toc .active-parent").forEach((node) => {
    node.classList.remove("active", "active-parent");
  });

  const visibleHeadingId = visibleHeadingIdFor(id);
  if (!visibleHeadingId) return;

  const link = document.querySelector(
    '.toc a[data-heading-id="' + CSS.escape(visibleHeadingId) + '"]',
  );
  if (!link) return;

  currentHeadingId = visibleHeadingId;
  link.classList.add("active");
  scrollActiveTocLinkIntoView(link);
}

function scrollActiveTocLinkIntoView(link) {
  const toc = link.closest(".toc");
  if (!toc) return;

  const linkRect = link.getBoundingClientRect();
  const tocRect = toc.getBoundingClientRect();
  const targetOffset = linkRect.top - tocRect.top - toc.clientHeight / 2 + link.clientHeight / 2;
  toc.scrollTo({
    top: toc.scrollTop + targetOffset,
    behavior: "smooth",
  });
}

function updateActiveHeading() {
  let current = activeHeadings[0];
  const activeLine = Math.round(window.innerHeight * 0.38);

  for (const heading of activeHeadings) {
    if (heading.getBoundingClientRect().top <= activeLine) {
      current = heading;
    } else {
      break;
    }
  }

  if (current) setActive(current.id);
}

window.addEventListener("scroll", handleScroll, { passive: true });
window.addEventListener("resize", updateActiveHeading);
refreshHeadingReferences();
restoreHeadingPosition();
updateActiveHeading();

modeToggle?.addEventListener("click", async () => {
  await toggleEditMode();
});

modeToggle?.addEventListener("pointerdown", () => {
  if (isEditing) return;
  transitionHeadingId = headingIdFromViewport() ?? activeTocHeadingId() ?? currentHeadingId;
});

window.addEventListener("keydown", async (event) => {
  if (event.key.toLowerCase() !== "e") return;
  if (!event.metaKey && !event.ctrlKey) return;

  event.preventDefault();
  if (!isEditing) {
    transitionHeadingId = headingIdFromViewport() ?? activeTocHeadingId() ?? currentHeadingId;
  }
  await toggleEditMode();
});

editor?.addEventListener("input", () => {
  syncEditorHeight();
  updateActiveEditorHeading();
  queueSave();
});

editor?.addEventListener("scroll", () => {
  updateActiveEditorHeading();
});

tocNav?.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-heading-id]");
  if (!link) return;

  event.preventDefault();
  const headingId = link.dataset.headingId;

  if (!isEditing) {
    history.pushState(null, "", link.getAttribute("href"));
    scrollToHeading(headingId);
    return;
  }

  const headingPosition = findMarkdownHeadingPosition(editor.value, headingId);
  if (!headingPosition) return;

  editor.focus({ preventScroll: true });
  scrollToEditorLine(headingPosition.line);
  setActive(headingId);
});

article?.addEventListener("click", (event) => {
  const link = event.target.closest(".heading-anchor");
  if (!link) return;

  const href = link.getAttribute("href");
  if (!href?.startsWith("#")) return;

  event.preventDefault();
  history.pushState(null, "", href);
  scrollToHeading(decodeURIComponent(href.slice(1)));
});

async function toggleEditMode() {
  if (isEditing) {
    await leaveEditMode();
    return;
  }

  await enterEditMode();
}

async function enterEditMode() {
  if (!editor || !article || !modeToggle) return;

  setSaveStatus("読み込み中");
  const response = await fetch("/source");
  if (!response.ok) {
    setSaveStatus("読み込み失敗");
    return;
  }

  editor.value = await response.text();
  const headingId = headingIdFromViewport() ?? activeTocHeadingId() ?? currentHeadingId;
  transitionHeadingId = headingId;
  const headingPosition = headingId ? findMarkdownHeadingPosition(editor.value, headingId) : null;
  const cursorPosition = headingPosition?.offset ?? 0;
  editor.selectionStart = cursorPosition;
  editor.selectionEnd = cursorPosition;
  isEditing = true;
  document.body.classList.add("editing");
  article.hidden = true;
  editor.hidden = false;
  syncEditorHeight();
  modeToggle.textContent = "プレビュー";
  modeToggle.setAttribute("aria-pressed", "true");
  setSaveStatus("編集可能");
  editor.focus({ preventScroll: true });
  scrollToEditorLine(headingPosition?.line ?? 0);
  updateActiveEditorHeading();
}

async function leaveEditMode() {
  if (!editor || !article || !modeToggle) return;

  const headingId = editorHeadingIdFromViewport() ?? transitionHeadingId ?? currentHeadingId;
  clearTimeout(saveTimer);
  await latestSave;
  await saveSource();
  const preview = await fetchContent();
  if (!preview) return;

  isEditing = false;
  document.body.classList.remove("editing");
  article.innerHTML = preview.content;
  if (tocNav) {
    tocNav.innerHTML = preview.toc;
  }
  refreshHeadingReferences();
  article.hidden = false;
  editor.hidden = true;
  modeToggle.textContent = "編集";
  modeToggle.setAttribute("aria-pressed", "false");
  const transition = () => {
    scrollToHeading(headingId);
  };
  requestAnimationFrame(transition);
  setTimeout(transition, 100);
}

function queueSave() {
  clearTimeout(saveTimer);
  setSaveStatus("保存待ち");
  saveTimer = setTimeout(() => {
    latestSave = latestSave.then(saveSource, saveSource);
  }, 500);
}

async function saveSource() {
  if (!editor) return;

  setSaveStatus("保存中");
  const response = await fetch("/source", {
    method: "PUT",
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
    body: editor.value,
  });

  if (!response.ok) {
    setSaveStatus("保存失敗");
    return;
  }

  setSaveStatus("保存済み");
}

function setSaveStatus(message) {
  if (!saveStatus) return;
  saveStatus.textContent = message;
}

function handleScroll() {
  if (isEditing) return;
  if (isProgrammaticScroll) return;
  updateActiveHeading();
}

function updateActiveEditorHeading() {
  const headingId = editorHeadingIdFromViewport();
  if (headingId) {
    setActive(headingId);
  }
}

async function fetchContent() {
  const response = await fetch("/content", { cache: "no-store" });
  if (!response.ok) {
    setSaveStatus("プレビュー更新失敗");
    return null;
  }
  return response.json();
}

function refreshHeadingReferences() {
  allHeadings = Array.from(
    document.querySelectorAll(
      "article h1[id], article h2[id], article h3[id], article h4[id], article h5[id], article h6[id]",
    ),
  );
  activeHeadings = allHeadings.filter((heading) => visibleHeadingLevels.has(heading.tagName));
}

function activeTocHeadingId() {
  return document.querySelector(".toc a.active")?.dataset.headingId ?? null;
}

function headingIdFromViewport() {
  let current = activeHeadings[0];
  const activeLine = Math.round(window.innerHeight * 0.38);

  for (const heading of activeHeadings) {
    if (heading.getBoundingClientRect().top <= activeLine) {
      current = heading;
    } else {
      break;
    }
  }

  return current?.id ?? null;
}

function editorHeadingIdFromViewport() {
  if (!editor) return null;

  const styles = getComputedStyle(editor);
  const lineHeight = Number.parseFloat(styles.lineHeight) || 24;
  const line = Math.max(
    Math.floor((editor.scrollTop + editor.clientHeight * 0.38) / lineHeight),
    0,
  );
  const offset = offsetAtMarkdownLine(editor.value, line);

  return findMarkdownHeadingIdBeforeOffset(editor.value, offset);
}

function offsetAtMarkdownLine(markdown, line) {
  const lines = markdown.split("\n");
  let offset = 0;

  for (let index = 0; index < Math.min(line, lines.length); index += 1) {
    offset += lines[index].length + 1;
  }

  return offset;
}

function findMarkdownHeadingIdBeforeOffset(markdown, offset) {
  let current = null;

  for (const heading of markdownHeadingPositions(markdown)) {
    if (heading.offset > offset) break;
    if (heading.level <= 3) {
      current = heading.id;
    }
  }

  return current;
}

function scrollToHeading(id, behavior = "auto") {
  if (!id) return;

  const heading = document.getElementById(id);
  if (!heading) return;

  suspendScrollActiveUpdate();
  heading.scrollIntoView({ behavior, block: "start" });
  setActive(id);
}

function suspendScrollActiveUpdate() {
  isProgrammaticScroll = true;
  clearTimeout(programmaticScrollTimer);
  programmaticScrollTimer = setTimeout(() => {
    isProgrammaticScroll = false;
  }, 200);
}

function visibleHeadingIdFor(id) {
  if (document.querySelector('.toc a[data-heading-id="' + CSS.escape(id) + '"]')) {
    return id;
  }

  let current = null;

  for (const heading of allHeadings) {
    if (visibleHeadingLevels.has(heading.tagName)) {
      current = heading.id;
    }
    if (heading.id === id) {
      return current;
    }
  }

  return current;
}

function scrollToEditorLine(line) {
  if (!editor) return;

  const styles = getComputedStyle(editor);
  const lineHeight = Number.parseFloat(styles.lineHeight) || 24;
  window.scrollTo({ top: 0, behavior: "auto" });
  editor.scrollTop = Math.max(line * lineHeight - editor.clientHeight * 0.28, 0);
}

function findMarkdownHeadingPosition(markdown, headingId) {
  return markdownHeadingPositions(markdown).find((heading) => heading.id === headingId) ?? null;
}

function markdownHeadingPositions(markdown) {
  const positions = [];
  const usedIds = new Map();
  const lines = markdown.split("\n");
  let offset = 0;

  for (let line = 0; line < lines.length; line += 1) {
    const text = lines[line];
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(text);

    if (match) {
      const level = match[1].length;
      const headingText = markdownHeadingText(match[2]);
      positions.push({
        id: uniqueSlug(headingText, usedIds),
        level,
        line,
        offset,
      });
    }

    offset += text.length + 1;
  }

  return positions;
}

function markdownHeadingText(markdown) {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_~]/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function uniqueSlug(text, usedIds) {
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

function syncEditorHeight() {
  if (!editor) return;
  editor.style.height = "";
}

function reloadWithHeadingRestoration(headingId = currentHeadingId) {
  try {
    if (headingId) {
      localStorage.setItem(headingStorageKey, headingId);
    }
  } catch {
    // Ignore storage failures; reload still works.
  }
  window.location.reload();
}

function restoreHeadingPosition() {
  let storedHeadingId = null;

  try {
    storedHeadingId = localStorage.getItem(headingStorageKey);
    localStorage.removeItem(headingStorageKey);
  } catch {
    storedHeadingId = null;
  }

  if (!storedHeadingId) return;

  const restore = () => {
    scrollToHeading(storedHeadingId, "auto");
  };

  requestAnimationFrame(restore);
  window.addEventListener(
    "load",
    () => {
      requestAnimationFrame(restore);
    },
    { once: true },
  );
  setTimeout(() => {
    restore();
  }, 100);
}
