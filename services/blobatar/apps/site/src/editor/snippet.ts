/**
 * The generator.
 *
 * The snippet is the page's deliverable — the tuned blobatar on screen is the
 * demonstration, this is the thing you leave with — so this is the one piece
 * here with a correctness property worth pinning, and `snippet.test.ts` pins
 * it: paste the output, render it, get the blobatar that was on screen.
 *
 * Pure, and separate from the panel for exactly that reason. A generator living
 * inside the component would be testable only by rendering one.
 */
import type { TraitOverrides } from "blobatar";
import { KEY_ORDER } from "./axes";
import {
  attrExpr,
  attrString,
  close,
  comment,
  exprClose,
  exprOpen,
  infoFor,
  objectKey,
  wrap,
  type Flavor,
  type Framework,
} from "@/frameworks";

/**
 * The call sites, which is what the tab strip is an axis over.
 *
 * Five of the seven are frameworks and differ only in package name and
 * attribute spelling, so they are one member of this union expanded rather than
 * five hand-written emitters — see `@/frameworks`. The other two are genuinely
 * different APIs: `string` returns markup and `http` is a URL, and neither has
 * a component to configure.
 */
export type Api = Framework | "string" | "http";
export type Motion = false | "hover" | "always";

export interface SnippetInput {
  api: Api;
  /** The name the preview is showing. Emitted literally — see `NAME_NOTE`. */
  name: string;
  /** The pinned traits. Empty means no `traits` at all in the output. */
  pinned: TraitOverrides;
  motion: Motion;
}

/**
 * `shape` is a valid identifier and `"eye.gap"` is not.
 *
 * Quoting every key would be uniform and slightly uglier; both are defensible
 * and the rule is to pick one. This picks the one a person writing the object
 * by hand would produce, since looking hand-written is the whole brief. Which
 * quote character it reaches for is the flavor's call, not this module's —
 * `objectKey` carries that, and the reason.
 */
const key = objectKey;

/**
 * Panel order, then anything else.
 *
 * The fallback is not dead code: it is what keeps an unknown key — one added to
 * `AXES` and forgotten here, or one restored from a config someone hand-edited
 * — in the output instead of silently dropped.
 */
function entries(pinned: TraitOverrides) {
  const known = KEY_ORDER.filter(k => k in pinned);
  const rest = Object.keys(pinned).filter(k => !KEY_ORDER.includes(k));
  return [...known, ...rest].map(k => [k, pinned[k]!] as const);
}

/**
 * A pinned value, as it is written in code.
 *
 * A list is the silhouette narrowed to several rather than fixed to one, and it
 * is emitted as a list — the library reads it directly, so the snippet stays an
 * object literal you can paste and hand-edit. That is the whole reason the
 * feature is a widened value type rather than a helper the editor generates a
 * call to: a generated `pickFrom(name, [...])` would be code you have to
 * understand before you can change it.
 */
const literal = (v: number | number[]) =>
  Array.isArray(v) ? `[${v.join(", ")}]` : String(v);

/**
 * The name is emitted literally, and it has to be.
 *
 * A real call site says `name={user.email}`, and the temptation is to emit that
 * — but every axis left unpinned still comes from the name, so a snippet that
 * substitutes a variable for the string the preview used renders a different
 * blobatar. The literal is the honest output; the comment is what tells you
 * which half of it is yours to replace.
 *
 * Spelled by the flavor rather than written out, because it sits in markup
 * position: see `comment`.
 */
const NAME_NOTE = "everything below comes from the name unless it is pinned";

export function snippet({ api, name, pinned, motion }: SnippetInput): string {
  const traits = entries(pinned);
  const seed = name || "blobatar";

  return api === "string"
    ? string(seed, traits, motion)
    : api === "http"
      ? http(seed, traits, motion)
      : component(api, seed, traits, motion);
}

/**
 * Any of the five adapters.
 *
 * One emitter rather than five because the adapters are one component with five
 * publishers: the props are identical, so what a Svelte snippet and a Preact
 * snippet disagree about is the package they import and how their template
 * spells an attribute — both of which are table lookups. The alternative, five
 * near-identical functions, is five places for a prop to be added to four of.
 */
function component(
  id: Framework,
  seed: string,
  traits: (readonly [string, number | number[]])[],
  motion: Motion,
) {
  const { pkg, flavor } = infoFor(id);

  const imports = [`import { Blobatar } from "${pkg}";`];
  // The trade the library documents, stated where it is taken rather than in
  // prose beside the box: animating is what moves the blobatar out of a single
  // `<img>` and into a dozen inline SVG nodes.
  if (motion)
    imports.push(
      `import "blobatar/motion.css"; // animate renders inline SVG, not one <img>`,
    );

  const lines: string[] = [];
  if (traits.length) lines.push(comment(flavor, NAME_NOTE));

  lines.push(`<Blobatar`, `  ${attrString(flavor, "name", seed)}`);
  // One key inline, several over lines. A person writing `{ shape: 0.14 }`
  // does not break it across four lines, and a person writing six of them does
  // not leave it on one.
  if (traits.length === 1) {
    const [k, v] = traits[0]!;
    lines.push(`  ${attrExpr(flavor, "traits", `{ ${key(flavor, k)}: ${literal(v)} }`)}`);
  } else if (traits.length) {
    // The delimiters end up on different lines, so this takes the pair rather
    // than `attrExpr`, which closes what it opens.
    lines.push(`  ${exprOpen(flavor, "traits")}`);
    for (const [k, v] of traits) lines.push(`    ${key(flavor, k)}: ${literal(v)},`);
    lines.push(`  ${exprClose(flavor)}`);
  }

  if (motion) lines.push(`  ${attrString(flavor, "animate", motion)}`);
  lines.push(close(flavor, true));

  return wrap(flavor, imports, lines);
}

function string(
  seed: string,
  traits: (readonly [string, number | number[]])[],
  motion: Motion,
) {
  const lines = [`import { blobatar } from "blobatar";`];
  lines.push("");

  // `animate` is honored by the adapters only — the string API returns static
  // markup whatever it is passed. Dropping it silently on the way over would
  // make this snippet a quieter blobatar than the one on screen, so it is
  // dropped out loud. Named for the option rather than for one package: there
  // are five adapters now, and the reader is on whichever tab they are on.
  if (motion)
    lines.push(`// animate is a component option — this renders static markup`);
  if (traits.length) lines.push(`// ${NAME_NOTE}`);

  // Named `seed` here where the component takes `name`: same value, and the
  // words differ because they are read in different positions. See CONTEXT.md.
  const call = `const svg = blobatar(${JSON.stringify(seed)}`;

  if (!traits.length) return [...lines, `${call});`].join("\n");

  lines.push(`${call}, {`);
  if (traits.length) {
    lines.push(`  traits: {`);
    // Plain JS, so the JSX flavor's quoting is simply JS quoting — there is no
    // template around this literal for a double quote to escape from.
    for (const [k, v] of traits) lines.push(`    ${key("jsx", k)}: ${literal(v)},`);
    lines.push(`  },`);
  }
  lines.push(`});`);

  return lines.join("\n");
}

/**
 * The endpoint, and the one API here that cannot carry everything the panel
 * pins.
 *
 * A URL's surface is `hue`, `tone`, `size`, `background`, `expression` and
 * `gen` — there is no spelling for a silhouette or an eye gap, and there should
 * not be: those are a geometry vocabulary, and putting forty trait positions in
 * a query string would make every one of them a public parameter of a service
 * anybody can link. So this emits what survives, and names what does not
 * directly above the URL. A snippet that quietly rendered a different blobatar
 * than the preview would be worse than one that says which axes it dropped.
 *
 * `gen` is pinned, unlike in the two library snippets, and for the mirror of
 * the reason they do not: there, the installed major selects the vocabulary and
 * the lockfile holds it still. A URL has no lockfile — an unversioned one
 * follows whatever the endpoint currently serves — so naming the generation is
 * how a pasted link keeps rendering the blobatar that was on screen. It is also
 * what earns the year-long immutable cache. See the endpoint's usage text.
 */
const ENDPOINT = "https://blobatar.dev/avatar/";

/** The generation the editor previews, which is the package it is built on. */
const GEN = 2;

/**
 * The pinned keys a URL can carry, in the units it spells them in.
 *
 * `hue` is degrees there and a position here — the library reads the trait as
 * `t.num("hue", 0, 360)`, so the conversion is the multiply and nothing else.
 * Two decimals is exact rather than approximate: pinning rounds to three, and
 * any three-decimal position times 360 lands on a multiple of 0.36.
 */
const URL_UNITS: Record<string, (v: number) => string> = {
  hue: v => String(Math.round(v * 36000) / 100),
  tone: String,
};

function http(
  seed: string,
  traits: (readonly [string, number | number[]])[],
  motion: Motion,
) {
  const query = [`gen=${GEN}`];
  const unspellable: string[] = [];
  const narrowed: string[] = [];
  for (const [k, v] of traits) {
    const unit = URL_UNITS[k];
    // Two ways to lose an axis here, and they are not the same thing to say. A
    // key the URL has no word for is gone because the service does not expose
    // it; a *narrowed* key is gone because a query parameter states one value
    // and "any of these" is not one — `tone` is spellable and still cannot be
    // sent as `tone=0.1,0.965`. Telling someone their tone has no URL spelling
    // when the very next snippet spells it is the kind of note that teaches
    // people to stop reading them.
    if (Array.isArray(v)) narrowed.push(k);
    else if (unit) query.push(`${k}=${unit(v)}`);
    else unspellable.push(k);
  }

  // Only what the URL cannot say for itself. There is no line explaining `gen`
  // or the name, because both are right there in the URL being explained — a
  // comment on every snippet is a comment nobody reads by the third one. What
  // is left is what a reader cannot see: the axes that did not fit, why they
  // did not, and the motion the endpoint will not serve.
  //
  // Short lines on purpose: this box is the narrow column on the page, and a
  // note that needs scrolling sideways to finish is another one nobody reads.
  const lines: string[] = [];
  if (unspellable.length)
    lines.push(`# no url spelling for ${unspellable.join(", ")} — from the name`);
  if (narrowed.length)
    lines.push(`# ${narrowed.join(", ")} narrowed — a url states one value, so this is from the name too`);
  if (motion) lines.push(`# static svg — animate is a component option`);

  lines.push(`${ENDPOINT}${encodeURIComponent(seed)}?${query.join("&")}`);
  return lines.join("\n");
}
