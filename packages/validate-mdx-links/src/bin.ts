#!/usr/bin/env node

/**
 * @file This script validates the internal links in the MDX files.
 * Note that it does not validate external links (e.g. to GitHub).
 *
 * Take note that this is specific to Next.js App Router and Nextra
 * resolution and might not be 1-1 with other frameworks.
 *
 * Usage:
 * validate-mdx-links --cwd <path> --files "content/**\/*.mdx" --verbose
 */
import { parseArgs } from "node:util";
import { validateMdxLinks, printErrors } from "./index.js";

const {
  values: { help, cwd, verbose, files },
} = parseArgs({
  options: {
    cwd: { type: "string", default: process.cwd() },
    files: { type: "string" },
    verbose: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
  strict: true,
});

if (help) {
  console.log(
    'Usage: validate-mdx-links --cwd <path> --files "content/**/*.mdx" --verbose'
  );
  process.exit(0);
}

if (!files) {
  console.error("No files passed. Please pass the --files option.");
  process.exit(1);
}

try {
  const errors = await validateMdxLinks({
    cwd,
    files,
    verbose,
  });

  if (errors.length > 0) {
    printErrors(errors);
    process.exit(1);
  }

  console.log("No broken links found!");
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
