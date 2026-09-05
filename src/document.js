// Pure document builders (no extension globals, no DOM).
// EPUB via JSZip, PDF via jsPDF. Image fetching is injected as `deps.fetchImage`
// so this module is unit-testable in plain Node.

import JSZip from "jszip";
import { jsPDF } from "jspdf";

export const MAX_IMAGES = 40;

function extForMime(mime) {
  switch (mime) {
    case "image/png": return "png";
    case "image/jpeg": case "image/jpg": return "jpg";
    case "image/gif": return "gif";
    case "image/webp": return "webp";
    case "image/svg+xml": return "svg";
    default: return "img";
  }
}

function pdfImageFormat(mime) {
  switch (mime) {
    case "image/png": return "PNG";
    case "image/jpeg": case "image/jpg": return "JPEG";
    case "image/webp": return "WEBP";
    default: return null;
  }
}

function bytesToBase64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return (typeof btoa === "function" ? btoa : (s) => Buffer.from(s, "binary").toString("base64"))(bin);
}

function cryptoUuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function xhtmlFromBlocks(blocks, imageMap) {
  const parts = [];
  const swapImg = (html) =>
    html.replace(/<img\s+src="(images\/img\d+)"([^>]*)\/>/g, (full, p, rest) => {
      const rel = imageMap.get(p);
      return rel ? `<img src="${rel}"${rest}/>` : "";
    });

  for (const b of blocks) {
    switch (b.t) {
      case "h": parts.push(`<h${b.level}>${swapImg(b.html)}</h${b.level}>`); break;
      case "p": parts.push(`<p>${swapImg(b.html)}</p>`); break;
      case "quote": parts.push(`<blockquote><p>${swapImg(b.html)}</p></blockquote>`); break;
      case "pre": parts.push(`<pre>${b.html}</pre>`); break;
      case "list": {
        const tag = b.ordered ? "ol" : "ul";
        const lis = b.items.map((it) => `<li>${swapImg(it.html)}</li>`).join("");
        parts.push(`<${tag}>${lis}</${tag}>`);
        break;
      }
      case "img": {
        const rel = imageMap.get(b.path);
        if (rel) parts.push(`<p class="img"><img src="${rel}" alt="${(b.alt || "").replace(/"/g, "&quot;")}"/></p>`);
        break;
      }
      case "hr": parts.push("<hr/>"); break;
    }
  }
  return parts.join("\n");
}

export async function buildEpub(meta, blocks, images, deps) {
  const fetchImage = deps.fetchImage;
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );

  const imageMap = new Map();
  const manifestImages = [];
  let count = 0;
  for (const img of images.slice(0, MAX_IMAGES)) {
    const got = await fetchImage(img.url);
    if (!got) continue;
    const ext = extForMime(got.mime);
    if (ext === "img") continue;
    const rel = `${img.path}.${ext}`;
    zip.file(`OEBPS/${rel}`, got.bytes);
    imageMap.set(img.path, rel);
    manifestImages.push({ id: `img${count++}`, href: rel, mime: got.mime });
  }

  const body = xhtmlFromBlocks(blocks, imageMap);
  const title = esc(meta.title);
  const author = esc(meta.byline || meta.siteName || "");
  const uid = "urn:uuid:" + cryptoUuid();
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  const sourceLine = meta.url ? `<p class="source">Source: <a href="${esc(meta.url)}">${esc(meta.url)}</a></p>` : "";
  const bylineLine = meta.byline ? `<p class="byline">${esc(meta.byline)}</p>` : "";
  const siteLine = meta.siteName ? `<p class="site">${esc(meta.siteName)}</p>` : "";

  zip.file(
    "OEBPS/style.css",
    `body{font-family:Georgia,serif;line-height:1.5;margin:0;padding:0;}
h1{font-size:1.6em;line-height:1.25;margin:0.6em 0 0.4em;}
h2{font-size:1.3em;margin:1em 0 0.4em;}
h3{font-size:1.1em;margin:1em 0 0.3em;}
p{margin:0 0 0.8em;}
p.img{text-align:center;margin:1em 0;}
img{max-width:100%;height:auto;}
blockquote{margin:0.8em 1.2em;font-style:italic;color:#333;border-left:3px solid #ccc;padding-left:0.8em;}
pre{white-space:pre-wrap;font-family:"Courier New",monospace;font-size:0.85em;background:#f4f4f4;padding:0.6em;border-radius:4px;overflow-wrap:anywhere;}
ul,ol{margin:0 0 0.8em 1.2em;}
li{margin:0 0 0.3em;}
hr{border:none;border-top:1px solid #ccc;margin:1.2em 0;}
.byline{color:#555;font-style:italic;margin:0 0 0.2em;}
.site,.source{color:#777;font-size:0.85em;}
header{margin-bottom:1.2em;border-bottom:1px solid #ddd;padding-bottom:0.6em;}`
  );

  zip.file(
    "OEBPS/chapter.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${title}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <header>
    <h1>${title}</h1>
    ${bylineLine}
    ${siteLine}
    ${sourceLine}
  </header>
  ${body}
</body>
</html>`
  );

  zip.file(
    "OEBPS/nav.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head><meta charset="utf-8"/><title>${title}</title></head>
<body>
  <nav epub:type="toc" id="toc"><h1>Contents</h1>
    <ol><li><a href="chapter.xhtml">${title}</a></li></ol>
  </nav>
</body>
</html>`
  );

  const manifestItems = [
    `<item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>`,
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="css" href="style.css" media-type="text/css"/>`,
    ...manifestImages.map((m) => `<item id="${m.id}" href="${m.href}" media-type="${m.mime}"/>`),
  ].join("\n    ");

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${uid}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>en</dc:language>
    ${author ? `<dc:creator>${author}</dc:creator>` : ""}
    ${meta.url ? `<dc:source>${esc(meta.url)}</dc:source>` : ""}
    <meta property="dcterms:modified">${now}</meta>
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
</package>`
  );

  return await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export async function buildPdf(meta, blocks, images, deps) {
  const fetchImage = deps.fetchImage;
  const PW = 445, PH = 594, M = 42;
  const CW = PW - M * 2;
  const doc = new jsPDF({ unit: "pt", format: [PW, PH], compress: true });
  let y = M;
  const bottom = PH - M;

  const ensure = (need) => {
    if (y + need > bottom) { doc.addPage(); y = M; }
  };
  const writeLines = (text, { size, style = "normal", font = "times", gap, indent = 0, color }) => {
    doc.setFont(font, style);
    doc.setFontSize(size);
    if (color) doc.setTextColor(color[0], color[1], color[2]); else doc.setTextColor(20, 20, 20);
    const lh = size * 1.38;
    const lines = doc.splitTextToSize(text || "", CW - indent);
    for (const line of lines) {
      ensure(lh);
      doc.text(line, M + indent, y + size);
      y += lh;
    }
    y += gap != null ? gap : size * 0.5;
  };

  writeLines(meta.title || "Article", { size: 19, style: "bold", gap: 6 });
  if (meta.byline) writeLines(meta.byline, { size: 10, style: "italic", color: [90, 90, 90], gap: 2 });
  const sub = [meta.siteName, meta.url].filter(Boolean).join("  ·  ");
  if (sub) writeLines(sub, { size: 8.5, font: "helvetica", color: [120, 120, 120], gap: 10 });
  ensure(2);
  doc.setDrawColor(200); doc.line(M, y, PW - M, y); y += 14;

  const imgData = new Map();
  const imgBlocks = blocks.filter((b) => b.t === "img").slice(0, MAX_IMAGES);
  for (const b of imgBlocks) {
    const src = images.find((im) => im.path === b.path);
    if (!src) continue;
    const got = await fetchImage(src.url);
    if (!got) continue;
    const fmt = pdfImageFormat(got.mime);
    if (!fmt) continue;
    imgData.set(b.path, { b64: `data:${got.mime};base64,${bytesToBase64(got.bytes)}`, fmt });
  }

  for (const b of blocks) {
    switch (b.t) {
      case "h":
        y += 4;
        writeLines(b.text, { size: b.level === 1 ? 15 : b.level === 2 ? 13 : 12, style: "bold", gap: 4 });
        break;
      case "p": writeLines(b.text, { size: 11.5, gap: 6 }); break;
      case "quote": writeLines(b.text, { size: 11, style: "italic", indent: 16, color: [70, 70, 70], gap: 6 }); break;
      case "pre": writeLines(b.text, { size: 9, font: "courier", gap: 6 }); break;
      case "list":
        for (let i = 0; i < b.items.length; i++) {
          const prefix = b.ordered ? `${i + 1}. ` : "•  ";
          writeLines(prefix + b.items[i].text, { size: 11.5, indent: 12, gap: 2 });
        }
        y += 4;
        break;
      case "img": {
        const data = imgData.get(b.path);
        if (!data) break;
        try {
          const props = doc.getImageProperties(data.b64);
          let w = CW, h = (props.height / props.width) * CW;
          const maxH = PH - M * 2;
          if (h > maxH) { h = maxH; w = (props.width / props.height) * h; }
          ensure(h + 6);
          const x = M + (CW - w) / 2;
          doc.addImage(data.b64, data.fmt, x, y, w, h);
          y += h + 10;
        } catch { /* skip */ }
        break;
      }
      case "hr":
        ensure(12);
        doc.setDrawColor(210); doc.line(M, y + 4, PW - M, y + 4); y += 14;
        break;
    }
  }

  return new Uint8Array(doc.output("arraybuffer"));
}
