#!/usr/bin/env node
/**
 * `bunx blobatar-codemod [paths…]`
 *
 * Walks the given paths (the working directory by default), rewrites every
 * `@blobatar/react` and `@blobatar/vue` specifier it finds, and prints what it
 * touched. `--dry-run` prints without writing.
 *
 * It deliberately does **not** edit `package.json` dependency *versions* or run
 * an install. Adding `@blobatar/react` to a project is one command the consumer
 * should run themselves, in their own package manager — a codemod that installs
 * things is a codemod people are right to be wary of.
 */

import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { MIGRATABLE, SKIP, transform } from "./index";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const roots = args.filter((a) => !a.startsWith("-"));
if (roots.length === 0) roots.push(process.cwd());

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".changeset") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue;
      yield* walk(full);
    } else if (MIGRATABLE.test(entry.name)) {
      yield full;
    }
  }
}

let files = 0;
let rewrites = 0;

for (const root of roots) {
  const info = await stat(root).catch(() => null);
  if (!info) {
    console.error(`blobatar-codemod: no such path: ${root}`);
    process.exitCode = 1;
    continue;
  }
  const paths = info.isDirectory() ? walk(root) : (async function* () { yield root; })();

  for await (const path of paths) {
    const before = await readFile(path, "utf8");
    const { code, changes } = transform(before);
    if (changes.length === 0) continue;

    files++;
    rewrites += changes.length;
    console.log(`${relative(process.cwd(), path) || path}`);
    for (const c of changes) console.log(`  ${c.line}: ${c.from} → ${c.to}`);
    if (!dryRun) await writeFile(path, code);
  }
}

if (files === 0) {
  console.log("Nothing to migrate — no `blobatar/react` or `blobatar/vue` specifiers found.");
} else {
  console.log(
    `\n${dryRun ? "Would rewrite" : "Rewrote"} ${rewrites} specifier${rewrites === 1 ? "" : "s"} across ${files} file${files === 1 ? "" : "s"}.`,
  );
  if (!dryRun) {
    console.log("\nNext, add the adapters you use — the codemod does not install for you:");
    console.log("  bun add @blobatar/react   # and/or @blobatar/vue");
  }
}
