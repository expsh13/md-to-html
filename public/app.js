const links = Array.from(document.querySelectorAll(".toc a[data-heading-id]"));
const resizer = document.querySelector(".toc-resizer");
const headings = links
  .map((link) => document.getElementById(link.dataset.headingId))
  .filter(Boolean);
const visibleHeadingLevels = new Set(["H1", "H2", "H3"]);
const activeHeadings = headings.filter((heading) => visibleHeadingLevels.has(heading.tagName));

let isResizingToc = false;
let savedTocWidth = null;

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

  const link = document.querySelector('.toc a[data-heading-id="' + CSS.escape(id) + '"]');
  if (!link) return;

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

window.addEventListener("scroll", updateActiveHeading, { passive: true });
window.addEventListener("resize", updateActiveHeading);
updateActiveHeading();
