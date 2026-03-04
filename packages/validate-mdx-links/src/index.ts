import { existsSync, globSync, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, resolve, basename, relative } from "node:path";
import GithubSlugger from "github-slugger";
import {
  scanURLs,
  validateFiles,
  type DetectedError,
  type ScanResult,
} from "next-validate-link";

type UrlMeta = {
  hashes?: string[];
  queries?: Record<string, string>[];
};

export { printErrors } from "next-validate-link";

export type ValidationResult = {
  file: string;
  detected: DetectedError[];
};

export interface ValidateMdxLinksOptions {
  cwd?: string;
  files: string;
  verbose?: boolean;
  contentDir?: string;
}

type FrameworkKind =
  | { type: "nextjs" }
  | { type: "content"; contentDir: string };

function readDeps(cwd: string): Set<string> {
  try {
    const pkg = JSON.parse(readFileSync(resolve(cwd, "package.json"), "utf-8"));
    return new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]);
  } catch {
    return new Set();
  }
}

function detectFramework(cwd: string): FrameworkKind {
  const deps = readDeps(cwd);

  const isFumadocs =
    deps.has("fumadocs-core") || deps.has("fumadocs-mdx") || deps.has("fumadocs-ui");
  const isNext = deps.has("next");

  // If fumadocs is present, prefer content-based scanning
  if (isFumadocs) {
    // Find content dir: check common locations
    for (const dir of ["content", "content/docs"]) {
      if (existsSync(resolve(cwd, dir))) {
        const mdxFiles = globSync(`${dir}/**/*.mdx`, { cwd });
        if (mdxFiles.length > 0) {
          return { type: "content", contentDir: dir };
        }
      }
    }
  }

  // Check for Next.js dirs (also validates against package.json if available)
  const nextDirs = ["app", "src/app", "pages", "src/pages"];
  for (const dir of nextDirs) {
    if (existsSync(resolve(cwd, dir))) {
      return { type: "nextjs" };
    }
  }

  // Fallback: content dir with MDX files
  if (existsSync(resolve(cwd, "content"))) {
    const mdxFiles = globSync("content/**/*.mdx", { cwd });
    if (mdxFiles.length > 0) {
      return { type: "content", contentDir: "content" };
    }
  }

  // If next is in deps but no app/pages dir found, still try Next.js scanner
  if (isNext) {
    return { type: "nextjs" };
  }

  return { type: "nextjs" };
}

const HEADING_REGEX = /^#{1,6}\s+(.+)$/gm;

function extractHashes(content: string): string[] {
  const slugger = new GithubSlugger();
  const hashes: string[] = [];
  let match;
  while ((match = HEADING_REGEX.exec(content)) !== null) {
    hashes.push(slugger.slug(match[1]!));
  }
  return hashes;
}

function buildContentScanResult(
  contentDir: string,
  cwd: string,
  verbose?: boolean
): ScanResult {
  const urls = new Map<string, UrlMeta>();
  const mdxFiles = globSync(`${contentDir}/**/*.mdx`, { cwd });

  for (const file of mdxFiles) {
    let urlPath = "/" + relative(contentDir, file);

    // strip .mdx extension
    urlPath = urlPath.replace(/\.mdx$/, "");

    // index → parent directory
    if (urlPath.endsWith("/index")) {
      urlPath = urlPath.slice(0, -"/index".length) || "/";
    }

    const content = readFileSync(resolve(cwd, file), "utf-8");
    const hashes = extractHashes(content);

    urls.set(urlPath, { hashes: hashes.length > 0 ? hashes : undefined });
  }

  if (verbose) {
    console.log(
      "\n" +
        "Scanned content routes:\n" +
        [...urls.keys()].map((x) => `"${x}"`).join(", ") +
        "\n"
    );
  }

  return { urls, fallbackUrls: [] };
}

export async function validateMdxLinks({
  cwd = process.cwd(),
  files: filesGlob,
  verbose = false,
  contentDir,
}: ValidateMdxLinksOptions): Promise<ValidationResult[]> {
  const originalCwd = process.cwd();
  process.chdir(cwd);

  const files = globSync(filesGlob);
  if (files.length === 0) {
    process.chdir(originalCwd);
    throw new Error("No files found matching the glob pattern");
  } else if (verbose) {
    console.log(`Found ${files.length} markdown files to validate.\n`);
  }

  let scanned: ScanResult;

  if (contentDir) {
    scanned = buildContentScanResult(contentDir, cwd, verbose);
  } else {
    const framework = detectFramework(cwd);
    if (framework.type === "content") {
      scanned = buildContentScanResult(framework.contentDir, cwd, verbose);
    } else {
      scanned = await scanURLs();
      if (verbose) {
        console.log(
          "\n" +
            "Scanned routes from the file system:\n" +
            [
              ...scanned.urls.keys(),
              ...scanned.fallbackUrls.map((x) => x.url),
            ]
              .map((x) => `"${x}"`)
              .join(", ") +
            "\n"
        );
      }
    }
  }

  const validations = await validateFiles(files, { scanned });

  const withoutFalsePositives = await Promise.all(
    validations.map(async ({ file, detected }) => {
      const filteredDetected: DetectedError[] = [];

      for (const error of detected) {
        let link = error[0];

        if (link.startsWith("./") || link.startsWith("../")) {
          // If there is a hash #id, we don't parse the file to find the heading,
          // just assume it exists and check if the file exists.
          link = link.split("#")[0] || "";

          {
            const path = resolve(dirname(file), link);

            if (await fileExists(path)) {
              // file exists, the error is a false positive
              continue;
            }
          }

          // if the file is called index.mdx and is in content dir, it turns out
          // both `./dirname/foo` and `./foo` links work and point to the same file and
          if (basename(file) === "index.mdx") {
            const dir = basename(dirname(file));
            const isSameDir = dir === basename(dirname(link));

            if (isSameDir) {
              const path = resolve(dirname(file), "..", `${link}.mdx`);
              if (await fileExists(path)) {
                // file exists, the error is a false positive
                continue;
              }
            }
          }

          // relative links can lose their .mdx extension
          if (!link.endsWith(".mdx")) {
            const dest = resolve(dirname(file), `${link}.mdx`);
            if (await fileExists(dest)) {
              // file exists, the error is a false positive
              continue;
            }
          }

          // relative links inside of JSX lose the .mdx extension
          // if the link is relative and the file containing the link is `page.mdx`,
          // we can check if {destination}/page.mdx exists
          if (basename(file) === "page.mdx") {
            const dest = resolve(dirname(file), "..", link, "page.mdx");
            if (await fileExists(dest)) {
              continue;
            }
          }

          // There's another case for a false postive:
          // We could have a relative link `./bar` from (a)/(b)/foo/page.mdx to (c)/bar/page.mdx
          // We should either open an issue in `next-validate-link` or handle it with glob patterns.
          // For now, prefer to use absolute links in cases like this.
        }

        filteredDetected.push(error);
      }

      if (filteredDetected.length === 0) {
        return null;
      }

      return {
        file,
        detected: filteredDetected,
      };
    })
  );

  process.chdir(originalCwd);

  return withoutFalsePositives.filter(
    (validation): validation is NonNullable<typeof validation> =>
      validation !== null
  );
}

async function fileExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
