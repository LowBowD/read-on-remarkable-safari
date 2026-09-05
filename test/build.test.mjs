import { buildEpub, buildPdf } from "../src/document.js";
import JSZip from "jszip";
import assert from "node:assert";

// 1x1 PNG
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0)
);

const deps = {
  async fetchImage(url) {
    if (url.includes("bad")) return null; // simulate a failed image
    return { bytes: PNG, mime: "image/png" };
  },
};

const meta = {
  title: "Testing <Articles> & “Quotes”",
  byline: "By Jane Doe",
  siteName: "Example News",
  url: "https://example.com/story?a=1&b=2",
};

const blocks = [
  { t: "h", level: 2, html: "A <strong>bold</strong> heading", text: "A bold heading" },
  { t: "p", html: 'An intro with a <a href="https://x.com">link</a> and <em>emphasis</em>.', text: "An intro with a link and emphasis." },
  { t: "img", path: "images/img0", alt: "a figure" },
  { t: "img", path: "images/img1", alt: "broken", },
  { t: "list", ordered: false, items: [{ html: "one", text: "one" }, { html: "two", text: "two" }] },
  { t: "quote", html: "Wisdom here", text: "Wisdom here" },
  { t: "pre", html: "code &lt;tag&gt;", text: "code <tag>" },
  { t: "hr" },
  { t: "p", html: "Closing paragraph.", text: "Closing paragraph." },
];
// img0 resolves, img1 is "bad" -> must be dropped gracefully
const images = [
  { path: "images/img0", url: "https://example.com/pic.png", alt: "a figure" },
  { path: "images/img1", url: "https://example.com/bad.png", alt: "broken" },
];

async function testEpub() {
  const bytes = await buildEpub(meta, blocks, images, deps);
  assert.ok(bytes instanceof Uint8Array && bytes.length > 500, "epub has bytes");

  const zip = await JSZip.loadAsync(bytes);

  // mimetype must exist and be exactly right
  const mimetype = await zip.file("mimetype").async("string");
  assert.strictEqual(mimetype, "application/epub+zip", "mimetype content");

  // required structural files
  for (const f of ["META-INF/container.xml", "OEBPS/content.opf", "OEBPS/chapter.xhtml", "OEBPS/nav.xhtml", "OEBPS/style.css"]) {
    assert.ok(zip.file(f), `epub contains ${f}`);
  }

  // the good image is embedded, the bad one is not
  assert.ok(zip.file("OEBPS/images/img0.png"), "good image embedded");
  assert.ok(!zip.file("OEBPS/images/img1.png"), "bad image skipped");

  const opf = await zip.file("OEBPS/content.opf").async("string");
  assert.ok(opf.includes("images/img0.png"), "opf manifest lists good image");
  assert.ok(!opf.includes("img1"), "opf omits failed image");
  assert.ok(opf.includes("Testing &lt;Articles&gt;"), "title is xml-escaped in opf");

  const chapter = await zip.file("OEBPS/chapter.xhtml").async("string");
  assert.ok(chapter.includes('<img src="images/img0.png"'), "chapter references good image");
  assert.ok(!chapter.includes("img1"), "chapter drops broken image tag");
  assert.ok(chapter.includes("<strong>bold</strong>"), "inline formatting preserved");
  assert.ok(chapter.includes('<a href="https://x.com">link</a>'), "links preserved");
  assert.ok(chapter.includes("code &lt;tag&gt;"), "pre content escaped");
  assert.ok(chapter.includes("&amp;") && !chapter.includes(' & '), "ampersand escaped");

  // XHTML well-formedness sanity: tags balanced for the ones we emit
  assert.ok((chapter.match(/<p>/g) || []).length >= 2, "paragraphs present");

  console.log("EPUB test passed  (", bytes.length, "bytes )");
}

async function testPdf() {
  const bytes = await buildPdf(meta, blocks, images, deps);
  assert.ok(bytes instanceof Uint8Array && bytes.length > 500, "pdf has bytes");
  const header = Buffer.from(bytes.slice(0, 5)).toString("latin1");
  assert.strictEqual(header, "%PDF-", "valid PDF header");
  const tail = Buffer.from(bytes.slice(-6)).toString("latin1");
  assert.ok(tail.includes("EOF"), "PDF EOF marker present");
  console.log("PDF test passed   (", bytes.length, "bytes )");
}

async function testEmptyish() {
  // A minimal article with no images and one paragraph shouldn't throw.
  const e = await buildEpub({ title: "X" }, [{ t: "p", html: "hi", text: "hi" }], [], deps);
  const p = await buildPdf({ title: "X" }, [{ t: "p", html: "hi", text: "hi" }], [], deps);
  assert.ok(e.length > 0 && p.length > 0, "minimal docs build");
  console.log("Minimal-content test passed");
}

await testEpub();
await testPdf();
await testEmptyish();
console.log("\nAll tests passed.");
