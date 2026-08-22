/**
 * Which packages a release publishes, derived rather than listed.
 *
 * `release.yml` needs three things that a hand-written list in YAML would let
 * drift apart: what to publish, what the tag must agree with, and what is
 * deliberately not on this release train. All three follow from facts already
 * stated elsewhere — `private` in each manifest, and the `fixed` group in
 * `.changeset/config.json` — so they are read from there instead.
 *
 * ## Why not `npm publish --workspaces`
 *
 * Because it is wrong here, and quietly. `--workspaces` publishes every
 * non-private workspace member, which includes `blobatar-codemod` — and the
 * codemod is unscoped precisely so the `fixed` group cannot drag it to the
 * library's version (see its `"//name"`). It sits at 0.1.0 while the library is
 * at 2.x, so a library release would attempt to republish an unchanged 0.1.0
 * and take the whole run down with EPUBLISHCONFLICT, *after* having already
 * published some of the lockstep set. A partial publish of a lockstep group is
 * the one outcome this pipeline must not produce.
 *
 * So the release publishes the lockstep group explicitly, and anything
 * publishable outside it is reported rather than ignored — a new package that
 * belongs on the train and is not on it should be visible in the log, not
 * discovered when someone cannot install it.
 */

import { readdirSync } from "node:fs";

type Manifest = { name?: string; version?: string; private?: boolean };

const config = (await Bun.file(".changeset/config.json").json()) as {
  fixed?: string[][];
};

/**
 * The lockstep group, as changesets understands it. Read from `fixed` rather
 * than restated, because these must be the same set: `fixed` is what keeps the
 * *published* versions in step, and this is what decides which packages a tag
 * publishes. Two lists would eventually disagree, and the failure would be a
 * package silently left behind at the old version.
 */
const FIXED: string[] = config.fixed?.[0] ?? [];

/** `@blobatar/*`-style globs only — one trailing `*`, no other wildcards. */
const inLockstep = (name: string) =>
  FIXED.some((pattern) =>
    pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : name === pattern,
  );

const members: { name: string; version: string; dir: string; lockstep: boolean }[] = [];

for (const dir of readdirSync("packages")) {
  const path = `packages/${dir}/package.json`;
  const file = Bun.file(path);
  if (!(await file.exists())) continue;

  const manifest = (await file.json()) as Manifest;
  // `private` is the only thing that decides publishability, and it is npm's
  // own rule rather than a convention this file invents. `packages/harness`
  // is the member it excludes today.
  if (manifest.private || !manifest.name || !manifest.version) continue;

  members.push({
    name: manifest.name,
    version: manifest.version,
    dir,
    lockstep: inLockstep(manifest.name),
  });
}

members.sort((a, b) => a.name.localeCompare(b.name));

// Tab-separated, because the consumer is a bash `while read` loop and the
// alternative is asking a shell to parse JSON.
for (const m of members) {
  console.log([m.name, m.version, m.lockstep ? "lockstep" : "independent"].join("\t"));
}
