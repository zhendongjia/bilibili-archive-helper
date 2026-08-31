import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docs = path.join(root, "docs");
const html = fs.readFileSync(path.join(docs, "index.html"), "utf8");
const script = fs.readFileSync(path.join(docs, "app.js"), "utf8");

for (const required of [
  "Bilibili-Archive-Helper-0.5.2.zip",
  "394BEDE39D9D845C97A3DF5967E88D6FBCFFCF61919A554C15C73AE9EE1C1101",
  "README.zh-CN.md",
  "SwitchyOmega",
  "archive-workflow.png",
]) {
  if (!html.includes(required)) throw new Error(`Website is missing required content: ${required}`);
}

const copyKeys = new Set([
  ...[...html.matchAll(/data-copy="([A-Za-z0-9]+)"/g)].map((match) => match[1]),
  ...[...html.matchAll(/data-alt-copy="([A-Za-z0-9]+)"/g)].map((match) => match[1]),
]);
for (const key of copyKeys) {
  const definitions = script.match(new RegExp(`\\b${key}:`, "g")) || [];
  if (definitions.length !== 2) throw new Error(`Website copy key must have English and Chinese values: ${key}`);
}

for (const relativePath of ["styles.css", "app.js", "favicon.svg", "assets/archive-workflow.png", ".nojekyll"]) {
  if (!fs.existsSync(path.join(docs, relativePath))) throw new Error(`Website asset is missing: ${relativePath}`);
}

if (!script.includes('startsWith("zh") ? "zh-CN" : "en"')) {
  throw new Error("Website must detect Chinese and otherwise default to English");
}

console.log(JSON.stringify({ copyKeys: copyKeys.size, htmlBytes: html.length, imageBytes: fs.statSync(path.join(docs, "assets", "archive-workflow.png")).size }));
