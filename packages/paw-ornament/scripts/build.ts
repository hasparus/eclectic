// Bundles the worker and the app and inlines both into one page:
//   dist/paw-ornament.html  page body, as published to claude.ai artifacts
//   dist/index.html         the same page as a standalone document
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

async function bundle(entry: string, define: Record<string, string> = {}): Promise<string> {
  const out = await Bun.build({ entrypoints: [join(root, entry)], format: "iife", target: "browser", minify: true, define });
  if (!out.success) {
    for (const log of out.logs) console.error(log);
    throw new Error(`bundling ${entry} failed`);
  }
  return out.outputs[0]!.text();
}

const worker = await bundle("src/worker.ts");
const app = await bundle("src/ui/app.ts", { __WORKER_SOURCE__: JSON.stringify(worker) });
// the bundle goes inside a <script>; make sure nothing in it can close the tag
const safe = app.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
const page = readFileSync(join(root, "src/app.html"), "utf8").replace("/*APP*/", () => safe);

mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist/paw-ornament.html"), page);
writeFileSync(
  join(root, "dist/index.html"),
  `<!doctype html>\n<html lang="pl">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n</head>\n<body>\n${page}\n</body>\n</html>\n`,
);
console.log(`built dist/ (page ${(page.length / 1024).toFixed(0)} KB, worker ${(worker.length / 1024).toFixed(0)} KB)`);
