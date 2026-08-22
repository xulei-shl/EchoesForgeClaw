/**
 * The wall's hand-lettered copy, in one place because a font depends on it.
 *
 * These strings are set in Caveat, which ships subset to *exactly the
 * characters they use* — around 11 KB where the whole Latin cut is 47. That
 * makes this file the input to a build artefact rather than ordinary copy: a
 * letter added here that is not in the subset renders in the fallback face and
 * nothing warns you, because a missing glyph is not an error. `copy.test.ts`
 * is what turns it into one.
 *
 * So: change a string, re-run the subset command in `fonts-src/README.md`, and
 * the test tells you if you forgot. Everything not in this object is set in
 * Geist and is free to say anything.
 */
export const HAND = {
  /** The placement panel's heading. Not "Place a blobatar" — the wall is a
   * place, and what you have done by clicking is find a spot on it. */
  spot: "You found a nice spot!",
} as const;

/**
 * The plain-font copy that goes with it.
 *
 * Here rather than inline in the component only because it is the other half of
 * the same voice and the two are easier to keep in tune side by side. The
 * question is asked in the second person and in the present tense on purpose:
 * the expression is how you are *now*, which is the only thing about a
 * permanent placement that is allowed to be a whim.
 */
export const SAID = {
  feeling: "How are you feeling today?",
  /** The submit. Lowercase like every other action on the site, and phrased as
   * leaving something rather than as submitting it. */
  leave: "leave it here",
  leaving: "leaving it",
  /** Under the name field, when the wall has never been written to. */
  first: "nobody has ever placed one — yours goes at the origin",
} as const;

/**
 * The seed the ghost blobatar is drawn from before anybody has typed anything.
 *
 * Not a placeholder in the input sense — it is never shown as text, and the
 * field's own placeholder is still "someone". This string exists only to
 * decide which blobatar stands in the empty cell while the panel waits, and it
 * is a *chosen* one: a seed is a hash, so an arbitrary word is an arbitrary
 * silhouette and palette, and the first thing a visitor sees the wall offer
 * them should not be whichever blob "you" happens to produce.
 *
 * Changing it changes only that first impression. The moment a character is
 * typed the ghost is the blobatar for what was typed, which is the whole point
 * of the section.
 */
export const EMPTY_SEED = "alain00";
