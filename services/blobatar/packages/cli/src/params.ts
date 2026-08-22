/**
 * The CLI's own option table: flag values to renderer options.
 *
 * It deliberately does not import the endpoint's table. The two surfaces share
 * a vocabulary — a param carries the same name, range and meaning in `--tone`
 * as in `?tone=` — but they do not share a transport, and the endpoint's table
 * is shaped by things a terminal has no version of: Gravatar's `s` alias, its
 * accepted-and-ignored `d`/`f`/`r` spellings, and a name parsed out of a URL
 * path. Importing it would drag that surface in to reuse a hundred lines, and
 * a package cannot import an app's source in any case.
 *
 * What that costs is worth stating plainly: a param added to the endpoint does
 * not appear here on its own. Keeping the two in step is a review job now,
 * which is why every option below is spelled the way the endpoint spells it.
 */
import type { BlobatarOptions } from "blobatar/blob";
import type { Expression } from "blobatar/expression";
import {
  happy, idle, love, mad, sad, scared, shy, sick, sleepy, smug, surprised, thinking,
  unsure, wink,
} from "blobatar/expression";

/** A caller error, carrying the text printed to stderr. */
export class BadRequest extends Error {}

/**
 * The whole roster, by name.
 *
 * Expressions are values rather than strings in the library so that a consumer
 * ships only the poses it uses (ADR-0002). A CLI, like a server, is a consumer
 * that uses all of them by definition, so the mapping the library declines to
 * make gets made here — explicitly, rather than by indexing the namespace,
 * which would also expose `poseVars` and `bakePose` as if they were poses.
 */
const EXPRESSIONS: Record<string, Expression> = {
  idle, happy, sad, mad, surprised, wink, sleepy, smug, unsure, scared, love, shy, sick,
  thinking,
};

export type Generation = 1 | 2;

/** Both majors the bin bundles. Entries only ever grow. */
const GENERATIONS: Record<string, Generation> = { 1: 1, 2: 2 };

/**
 * The option surface a flag can state.
 *
 * A subset of `BlobatarOptions` for the same reason the endpoint's is: one
 * renderer type has to accept both generations, and they are two packages that
 * agree on everything a flag can spell and are free to diverge on everything it
 * cannot. `traits` and `palette` are absent here as there — a sparse map of
 * 0–1 positions and a contrast-guarantee bypass are for callers importing the
 * library, not for argv.
 */
export type UrlOptions = Pick<
  BlobatarOptions,
  "size" | "background" | "hue" | "tone" | "expression" | "title"
>;

export interface RenderRequest {
  generation: Generation;
  options: UrlOptions;
}

/** `none` is the transparent case, spelled as a word because a flag has no booleans. */
const BACKGROUNDS: Record<string, UrlOptions["background"]> = {
  none: false,
  square: "square",
  circle: "circle",
  squircle: "squircle",
};

/** `title` lands in the accessible name, where a paragraph is already wrong. */
const MAX_TITLE = 128;

/**
 * The markup is byte-identical at every size — `size` only emits `width` and
 * `height` over a fixed viewBox — so these bound legibility, not cost.
 */
export const MIN_SIZE = 8;
export const MAX_SIZE = 1024;

function number(raw: string, key: string, min: number, max: number): number {
  const n = Number(raw);
  // `Number("")` is 0 and `Number(" 12 ")` is 12, neither of which anyone meant
  // to write. Checking the parse this way also rejects `NaN` and both infinities.
  if (raw.trim() === "" || !Number.isFinite(n)) {
    throw new BadRequest(`${key} must be a number, got "${raw}"`);
  }
  if (n < min || n > max) throw new BadRequest(`${key} must be between ${min} and ${max}, got ${n}`);
  return n;
}

function oneOf<T>(raw: string, key: string, table: Record<string, T>): T {
  // An own-property check rather than a truthy lookup or `in`: `background=none`
  // maps to `false`, which truthiness would reject, and a plain object answers
  // `in` truthily for `__proto__` and `constructor` — neither of which is an
  // entry, and both of which would flow downstream as one.
  if (!Object.hasOwn(table, raw)) {
    throw new BadRequest(`unknown ${key} "${raw}" — expected one of ${Object.keys(table).join(", ")}`);
  }
  return table[raw]!;
}

/** The collected flag values as renderer options. */
export function parseOptions(params: Map<string, string>): RenderRequest {
  const opts: UrlOptions = {};
  const get = (key: string) => params.get(key) ?? null;
  const size = get("size");
  const background = get("background");
  const hue = get("hue");
  const tone = get("tone");
  const expression = get("expression");
  const title = get("title");
  const gen = get("gen");

  /*
   * Clamped, where every other option here is validated — the same asymmetry
   * the endpoint makes, and for the surviving half of the same reason: size is
   * the one option that cannot make the answer *wrong*. A clamped `--size 2048`
   * is the right blobatar at the wrong scale, which is a resize away; an error
   * is no blobatar at all.
   */
  if (size !== null) {
    const n = Number(size.trim() === "" ? NaN : size);
    if (!Number.isFinite(n)) throw new BadRequest(`size must be a number, got "${size}"`);
    opts.size = Math.round(Math.min(MAX_SIZE, Math.max(MIN_SIZE, n)));
  }
  const generation = gen === null ? 2 : oneOf(gen, "gen", GENERATIONS);
  if (background !== null) opts.background = oneOf(background, "background", BACKGROUNDS);
  // 360 is admitted alongside 0 rather than excluded as a duplicate: hue is a
  // circle, callers compute into it, and rejecting the value that a full turn
  // lands on would be a trap. The library takes it modulo.
  if (hue !== null) opts.hue = number(hue, "hue", 0, 360);
  // Inclusive at 1, matching the library and the endpoint: the tone swatches
  // are banded with half-open edges, so an exact 1 sits on the top edge and
  // renders as `--tone 0`. Not papered over here — one value means one thing
  // in argv, in a URL and in a library call. See CONTEXT.md's Tone entry.
  if (tone !== null) opts.tone = number(tone, "tone", 0, 1);
  if (expression !== null) opts.expression = oneOf(expression, "expression", EXPRESSIONS);
  if (title !== null) {
    if (title.length > MAX_TITLE) {
      throw new BadRequest(`title must be ${MAX_TITLE} characters or fewer, got ${title.length}`);
    }
    opts.title = title;
  }
  return { generation, options: opts };
}
