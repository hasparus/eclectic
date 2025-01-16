import { globSync } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  scanURLs,
  validateFiles,
  type DetectedError,
} from "next-validate-link";

export { printErrors } from "next-validate-link";

export type ValidationResult = {
  file: string;
  detected: DetectedError[];
};

export interface ValidateMdxLinksOptions {
  cwd?: string;
  files: string;
  verbose?: boolean;
}

export async function validateMdxLinks({
  cwd = process.cwd(),
  files: filesGlob,
  verbose = false,
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

  const scanned = await scanURLs();

  console.log(
    "\n" +
      "Scanned routes from the file system:\n" +
      [...scanned.urls.keys(), ...scanned.fallbackUrls.map((x) => x.url)]
        .map((x) => `"${x}"`)
        .join(", ") +
      "\n"
  );

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

          // relative links inside of JSX lose the .mdx extension
          if (!link.endsWith(".mdx")) {
            link = `${link}.mdx`;
          }

          const path = resolve(dirname(file), link);
          const stats = await stat(path).catch(() => false);

          if (stats) {
            // file exists, the error is a false positive
            continue;
          }
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
