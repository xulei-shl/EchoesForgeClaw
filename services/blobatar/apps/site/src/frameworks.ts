/**
 * The five adapters, as the two snippet generators need to know them.
 *
 * Shared rather than duplicated because there are two generators — the hero's
 * four-axis one and the editor's — and a framework that exists in one but not
 * the other is the exact drift this table prevents. It is also why the flavor
 * is data here rather than a branch in each generator: adding a sixth adapter
 * should be a row, not two new emitters.
 *
 * Deliberately small and free of editor imports. The hero is on the landing
 * page, whose first paint the whole build is tuned around, and this module is
 * what it pulls in to know that Svelte exists.
 */

/** The published adapters. `react` first because it is the default tab. */
export type Framework = "react" | "vue" | "svelte" | "solid" | "preact";

/**
 * How a framework spells an attribute, which is the only axis they differ on.
 *
 * `jsx` covers React, Solid and Preact — three different runtimes that read the
 * identical source, so the snippet for one is the snippet for the others with
 * the package name swapped. Svelte's template is close enough to JSX in the
 * attribute position to share its rules and differs only in the module wrapper;
 * Vue differs in both.
 */
export type Flavor = "jsx" | "svelte" | "vue";

export interface FrameworkInfo {
  id: Framework;
  /** The published package the snippet imports from. */
  pkg: string;
  /** The filename shown above the code box, which is how a reader places it. */
  file: string;
  flavor: Flavor;
}

export const FRAMEWORKS: readonly FrameworkInfo[] = [
  { id: "react", pkg: "@blobatar/react", file: "Blobatar.tsx", flavor: "jsx" },
  { id: "vue", pkg: "@blobatar/vue", file: "Blobatar.vue", flavor: "vue" },
  { id: "svelte", pkg: "@blobatar/svelte", file: "Blobatar.svelte", flavor: "svelte" },
  { id: "solid", pkg: "@blobatar/solid", file: "Blobatar.tsx", flavor: "jsx" },
  { id: "preact", pkg: "@blobatar/preact", file: "Blobatar.tsx", flavor: "jsx" },
];

const BY_ID = new Map(FRAMEWORKS.map(f => [f.id, f]));

export const isFramework = (v: string): v is Framework => BY_ID.has(v as Framework);

/** Never `undefined`: an id off this table is a bug, and React is the honest fallback. */
export const infoFor = (id: Framework): FrameworkInfo => BY_ID.get(id) ?? FRAMEWORKS[0]!;

/**
 * Both packages, in the order you install them.
 *
 * Core is not a transitive dependency of an adapter — every adapter declares it
 * as a peer (`"blobatar": "2.x"`), so it has to be named here or the paste
 * produces an unmet peer warning and no renderer. See the adapters'
 * `//peerDependencies` note.
 */
/**
 * How you get it — which is not the same axis as which framework you get.
 *
 * `bun`, `npm` and `pnpm` differ only in the verb; the code below the command
 * is identical for all three. `shadcn` is the odd one and belongs here anyway:
 * it is still the answer to "how do I install this", it is just an answer that
 * also changes what you import, because what it installs is a file in your own
 * tree rather than a package in `node_modules`.
 *
 * No `yarn`. The README says "npm / pnpm / yarn all work too" and that is still
 * true — this is a strip of four on a hero, not a compatibility matrix, and the
 * fourth slot buys more as shadcn than as a fourth spelling of `add`.
 */
export type Manager = "bun" | "npm" | "pnpm" | "shadcn";

export const MANAGERS: readonly Manager[] = ["bun", "npm", "pnpm", "shadcn"];

export const isManager = (v: string): v is Manager => MANAGERS.includes(v as Manager);

/**
 * The install command.
 *
 * `pm` is optional and defaults to `bun` so the editor, which has no such
 * selector and no room for one, keeps calling this with a single argument.
 */
export function installFor(id: Framework, pm: Manager = "bun"): string {
  const { pkg } = infoFor(id);
  if (pm === "shadcn") return SHADCN_ADD;
  const verb = pm === "npm" ? "npm i" : `${pm} add`;
  return `${verb} blobatar ${pkg}`;
}

/**
 * The shadcn/ui registry item, as one command you can paste.
 *
 * A manager rather than a sixth row in the table above, and the difference is
 * not pedantry: every row there is an adapter, spelled the same way — a package
 * you install and a `Blobatar` you import. This is a distribution channel for
 * the React one, so it sits on the axis that already means "how do I get it".
 * A row would have made both snippet generators emit it, including the
 * editor's, where twenty tuned axes would have to nest inside a `blobatar` prop.
 *
 * The direct URL rather than the two-step `registry add @blobatar=…` the READMEs
 * teach. Both work; this one is a single line, and a hero is not where somebody
 * registers a namespace they have not decided to use yet.
 *
 * `apps/site/registry.test.ts` asserts this names the item the repo actually
 * publishes. It is a hardcoded string against a JSON file two directories up,
 * which is precisely the pair that drifts.
 */
export const SHADCN_ADD = "npx shadcn@latest add https://blobatar.dev/r/avatar.json";

/**
 * What the shadcn item installs into your tree, which is not a package import.
 *
 * The wrapper lands at the consumer's own UI alias, so the snippet under this
 * manager is the only one on the page that imports from `@/` rather than from
 * a published name — and the only one whose filename is theirs to change.
 */
export const SHADCN_FILE = "blobatar.tsx";

/**
 * A string-valued attribute.
 *
 * The two template flavors part company here, and it is worth being precise
 * about why rather than treating one as the other's dialect.
 *
 * JSX attribute strings are not JS strings — no backslash escapes — so a name
 * containing a quote cannot be written as `name="…"` at all, and falls through
 * to an expression container. Svelte's template takes the same escape hatch
 * with the same syntax.
 *
 * Vue needs no escape hatch, because its template really is HTML: the quote is
 * an entity, and `name="say &quot;hi&quot;"` is a plain static prop whose value
 * is exactly the name. The expression form was the obvious first move here and
 * is the wrong one — `:name="'say "hi"'"` closes the attribute on its own third
 * quote, and no amount of JS-level escaping reaches a problem that happens one
 * layer above JS.
 */
export function attrString(flavor: Flavor, name: string, value: string): string {
  if (flavor === "vue") return `${name}="${htmlAttr(value)}"`;
  return /["\\]/.test(value)
    ? `${name}={${JSON.stringify(value)}}`
    : `${name}="${value}"`;
}

/**
 * A value going into a double-quoted HTML attribute.
 *
 * `&` first, or the second replace's output gets escaped by the first on a
 * later pass — the classic ordering bug in a two-line escaper.
 */
const htmlAttr = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/** A JS expression in attribute position — a number, an identifier, an object literal. */
export const attrExpr = (flavor: Flavor, name: string, expr: string) =>
  flavor === "vue" ? `:${name}="${expr}"` : `${name}={${expr}}`;

/**
 * The same expression attribute, opened and closed on different lines.
 *
 * `attrExpr` cannot serve a multi-line object literal — it closes what it
 * opens — and the two delimiters are not the same character on both ends in
 * Vue, so a caller cannot simply reuse one of them reversed. Hence a pair.
 */
export const exprOpen = (flavor: Flavor, name: string) =>
  flavor === "vue" ? `:${name}="{` : `${name}={{`;

export const exprClose = (flavor: Flavor) => (flavor === "vue" ? `}"` : "}}");

/**
 * A JS string literal in single quotes.
 *
 * `JSON.stringify` is the wrong tool here and quietly so: it emits the double
 * quotes that are the whole problem. Escaping by hand is two characters —
 * backslash first, or it doubles the ones the second replace adds.
 */
const singleQuoted = (value: string) =>
  `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

const bare = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * An object key, quoted only where it has to be.
 *
 * `shape` is a valid identifier and `"eye.gap"` is not. The quote *character*
 * follows the flavor for the same reason `attrString` does: a Vue object
 * literal lives inside a double-quoted attribute, so a double-quoted key inside
 * it closes the attribute early and the template stops parsing.
 */
export const objectKey = (flavor: Flavor, k: string) =>
  bare.test(k) ? k : flavor === "vue" ? singleQuoted(k) : JSON.stringify(k);

/**
 * A comment in *markup* position, which is not the same language as the script.
 *
 * The one thing a template flavor cannot borrow from JSX. `// …` beside a JSX
 * element is a comment; the identical line inside a Svelte or Vue template is
 * text, and it renders — so a snippet that took the JSX spelling everywhere
 * would paste into a Vue app and draw its own annotation on the page next to
 * the blobatar. Inside `<script>` the JS spelling is correct and this helper is
 * not the one to reach for.
 */
export const comment = (flavor: Flavor, text: string) =>
  flavor === "jsx" ? `// ${text}` : `<!-- ${text} -->`;

/**
 * The module around the element.
 *
 * JSX has none — the imports and the element are the file. The two
 * single-file-component formats wrap it, and they disagree about indentation
 * inside `<script>`: Svelte's convention indents the body, Vue's `<script
 * setup>` does not. Following each rather than picking one keeps the output
 * looking like the framework's own docs, which is the entire job of a snippet.
 */
export function wrap(flavor: Flavor, imports: string[], element: string[]): string {
  if (flavor === "jsx") return [...imports, "", ...element].join("\n");

  if (flavor === "svelte")
    return [
      "<script>",
      ...imports.map(line => `  ${line}`),
      "</script>",
      "",
      ...element,
    ].join("\n");

  return [
    "<script setup>",
    ...imports,
    "</script>",
    "",
    "<template>",
    ...element.map(line => `  ${line}`),
    "</template>",
  ].join("\n");
}

/**
 * The element's closing line.
 *
 * `semi` is the caller's, not the flavor's: JSX *can* carry a statement
 * terminator and the editor's snippet does, because it is a standalone
 * expression you paste. A template language cannot carry one at all, so the
 * request is honored only where it is legal.
 */
export const close = (flavor: Flavor, semi = false) =>
  semi && flavor === "jsx" ? "/>;" : "/>";
