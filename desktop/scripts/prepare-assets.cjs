"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

async function main() {
  const packageRoot = path.join(__dirname, "..", "node_modules", "pdfjs-dist", "legacy", "build");
  const target = path.join(__dirname, "..", "..", "docs", "quiz", "vendor");
  await fs.mkdir(target, { recursive: true });
  await fs.copyFile(path.join(packageRoot, "pdf.mjs"), path.join(target, "pdf.mjs"));
  await fs.copyFile(path.join(packageRoot, "pdf.worker.mjs"), path.join(target, "pdf.worker.mjs"));
  process.stdout.write("Bundled PDF.js 6.5.438 assets into docs/quiz/vendor.\n");
}

main().catch((error) => {
  process.stderr.write(error.stack || String(error));
  process.exitCode = 1;
});