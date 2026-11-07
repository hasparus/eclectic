// Inlines the generator into the page. Writes:
//   dist/paw-ornament.html  page body, as published to claude.ai artifacts
//   dist/index.html         the same page as a standalone document
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const generator = readFileSync(join(root, "src/generator.js"), "utf8").replace(/^export /gm, "");
const app = readFileSync(join(root, "src/app.html"), "utf8");
if (generator.includes("</script")) throw new Error("generator source must not contain </script");
const page = app.replace("/*GENERATOR*/", () => generator);

mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist/paw-ornament.html"), page);
writeFileSync(
  join(root, "dist/index.html"),
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n</head>\n<body>\n${page}\n</body>\n</html>\n`,
);
console.log(`built dist/ (${(page.length / 1024).toFixed(0)} KB)`);
