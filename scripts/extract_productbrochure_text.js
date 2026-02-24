const fs = require("fs");
const path = require("path");
const pdfParseMod = require("pdf-parse");
const PDFParse = pdfParseMod && typeof pdfParseMod.PDFParse === "function" ? pdfParseMod.PDFParse : null;

async function main() {
  const input = process.argv[2] || path.join(__dirname, "..", "public", "productbrochure.pdf");
  const output = process.argv[3] || path.join(__dirname, "..", "public", "productbrochure.txt");

  if (!PDFParse) {
    throw new Error("pdf-parse did not export PDFParse class");
  }

  const buf = fs.readFileSync(input);
  // pdf-parse rejects Node.js Buffer instances (even though Buffer is a Uint8Array subclass).
  // Provide a plain Uint8Array.
  const bytes = new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const parser = new PDFParse(bytes);
  const textResult = await parser.getText();
  const text = (textResult && typeof textResult === "object" && typeof textResult.text === "string")
    ? textResult.text
    : String(textResult || "");
  const info = await parser.getInfo().catch(() => null);
  const numpages = info && typeof info.pages === "number" ? info.pages : undefined;

  const header = [
    `# Extracted from: ${path.relative(process.cwd(), input)}`,
    `# Pages: ${typeof numpages === "number" ? numpages : "unknown"}`,
    ""
  ].join("\n");

  fs.writeFileSync(output, header + String(text || ""), "utf8");
  process.stdout.write(`Wrote ${output}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
