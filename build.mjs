import * as esbuild from "esbuild";

const common = {
  bundle: true,
  format: "iife",
  target: ["safari16"],
  logLevel: "info",
  legalComments: "none",
  minify: true,
};

await esbuild.build({
  ...common,
  entryPoints: ["src/background.js"],
  outfile: "extension/background.js",
  // Service worker: keep it a classic script.
});

await esbuild.build({
  ...common,
  entryPoints: ["src/content.js"],
  outfile: "extension/content.js",
});

await esbuild.build({
  ...common,
  entryPoints: ["src/popup.js"],
  outfile: "extension/popup.js",
  minify: false,
});

console.log("Build complete.");
