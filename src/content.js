// Content script: extracts the readable article from the current page.
// Runs in the page context (has full DOM access), then hands a clean,
// serializable "blocks" structure to the background service worker,
// which turns it into an EPUB or PDF and uploads it to reMarkable.

import { Readability, isProbablyReaderable } from "@mozilla/readability";

const api = globalThis.browser ?? globalThis.chrome;

const BLOCK_TAGS = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6",
  "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "FIGURE", "FIGCAPTION",
  "IMG", "HR", "TABLE",
]);

// Inline tags we keep (as sanitized XHTML) inside paragraphs/headings.
const INLINE_KEEP = new Set(["A", "B", "STRONG", "I", "EM", "CODE", "SUP", "SUB", "U", "S", "BR"]);

function absolutize(url) {
  try {
    return new URL(url, document.baseURI).href;
  } catch {
    return null;
  }
}

function escapeText(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s) {
  return escapeText(s).replace(/"/g, "&quot;");
}

// Serialize the inline children of a block element to sanitized XHTML.
// Collects images encountered inline into `images`.
function serializeInline(node, images) {
  let out = "";
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      out += escapeText(child.nodeValue);
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = child.tagName;
      if (tag === "BR") {
        out += "<br/>";
      } else if (tag === "IMG") {
        const rec = registerImage(child, images);
        if (rec) out += `<img src="${escapeAttr(rec.path)}" alt="${escapeAttr(rec.alt)}"/>`;
      } else if (INLINE_KEEP.has(tag)) {
        const name = tag.toLowerCase();
        if (tag === "A") {
          const href = child.getAttribute("href");
          const abs = href ? absolutize(href) : null;
          if (abs) {
            out += `<a href="${escapeAttr(abs)}">${serializeInline(child, images)}</a>`;
          } else {
            out += serializeInline(child, images);
          }
        } else {
          out += `<${name}>${serializeInline(child, images)}</${name}>`;
        }
      } else {
        // Unknown inline element: keep its text content only.
        out += serializeInline(child, images);
      }
    }
  }
  return out;
}

let imgCounter = 0;
function registerImage(imgEl, images) {
  const rawSrc =
    imgEl.getAttribute("src") ||
    imgEl.getAttribute("data-src") ||
    (imgEl.getAttribute("srcset") || "").split(" ")[0] ||
    "";
  const abs = absolutize(rawSrc);
  if (!abs || abs.startsWith("data:")) {
    // Inline data URIs: keep as-is only if reasonably small.
    if (abs && abs.startsWith("data:") && abs.length < 200000) {
      const path = `images/img${imgCounter++}`;
      const rec = { path, url: abs, alt: imgEl.getAttribute("alt") || "", dataUri: true };
      images.push(rec);
      return rec;
    }
    return null;
  }
  const path = `images/img${imgCounter++}`;
  const rec = { path, url: abs, alt: imgEl.getAttribute("alt") || "" };
  images.push(rec);
  return rec;
}

// Walk the parsed article content into an ordered list of blocks.
function walk(container, blocks, images) {
  for (const el of container.children) {
    const tag = el.tagName;
    if (!BLOCK_TAGS.has(tag)) {
      // Descend into wrappers (div/section/article/etc).
      walk(el, blocks, images);
      continue;
    }
    switch (tag) {
      case "H1": case "H2": case "H3": case "H4": case "H5": case "H6": {
        const level = Math.min(3, parseInt(tag[1], 10));
        const html = serializeInline(el, images).trim();
        const text = el.textContent.trim();
        if (text) blocks.push({ t: "h", level, html, text });
        break;
      }
      case "P": case "BLOCKQUOTE": case "FIGCAPTION": {
        const html = serializeInline(el, images).trim();
        const text = el.textContent.trim();
        if (html) blocks.push({ t: el.tagName === "BLOCKQUOTE" ? "quote" : "p", html, text });
        break;
      }
      case "PRE": {
        const text = el.textContent.replace(/\s+$/, "");
        if (text.trim()) blocks.push({ t: "pre", html: escapeText(text), text });
        break;
      }
      case "UL": case "OL": {
        const items = [];
        for (const li of el.children) {
          if (li.tagName !== "LI") continue;
          const html = serializeInline(li, images).trim();
          const text = li.textContent.trim();
          if (html) items.push({ html, text });
        }
        if (items.length) blocks.push({ t: "list", ordered: tag === "OL", items });
        break;
      }
      case "FIGURE": {
        // Figures usually wrap an <img> + <figcaption>; recurse.
        walk(el, blocks, images);
        break;
      }
      case "IMG": {
        const rec = registerImage(el, images);
        if (rec) blocks.push({ t: "img", path: rec.path, alt: rec.alt });
        break;
      }
      case "TABLE": {
        // Represent tables as preformatted text (reMarkable reflow is text-first).
        const rows = [];
        for (const tr of el.querySelectorAll("tr")) {
          const cells = [...tr.children].map((c) => c.textContent.trim());
          if (cells.some((c) => c)) rows.push(cells.join("\t"));
        }
        if (rows.length) {
          const text = rows.join("\n");
          blocks.push({ t: "pre", html: escapeText(text), text });
        }
        break;
      }
      case "HR": {
        blocks.push({ t: "hr" });
        break;
      }
      default:
        walk(el, blocks, images);
    }
  }
}

function extract() {
  const documentClone = document.cloneNode(true);
  const reader = new Readability(documentClone, { keepClasses: false });
  const article = reader.parse();

  const images = [];
  imgCounter = 0;
  const blocks = [];

  if (article && article.content) {
    const holder = document.createElement("div");
    holder.innerHTML = article.content;
    walk(holder, blocks, images);
  }

  // Fallback: if Readability failed or produced almost nothing.
  if (blocks.length < 2) {
    const title = document.title || "Untitled";
    const text = (document.body?.innerText || "").trim();
    const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).slice(0, 400);
    blocks.length = 0;
    for (const p of paras) blocks.push({ t: "p", html: escapeText(p), text: p });
    return {
      ok: blocks.length > 0,
      title,
      byline: "",
      siteName: location.hostname,
      url: location.href,
      blocks,
      images: [],
    };
  }

  return {
    ok: true,
    title: (article.title || document.title || "Untitled").trim(),
    byline: (article.byline || "").trim(),
    siteName: (article.siteName || location.hostname || "").trim(),
    excerpt: (article.excerpt || "").trim(),
    url: location.href,
    blocks,
    images,
  };
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === "extract") {
    try {
      sendResponse(extract());
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
    }
    return true;
  }
  if (msg && msg.action === "ping") {
    sendResponse({ ok: true, readerable: safeReaderable() });
    return true;
  }
});

function safeReaderable() {
  try {
    return isProbablyReaderable(document);
  } catch {
    return true;
  }
}
