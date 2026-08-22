import {
  happy, idle, love, mad, sad, scared, shy, sick, sleepy, smug, surprised, thinking,
  unsure, wink,
} from "blobatar/expression";
import type { Expression } from "blobatar/expression";

/**
 * The faces the wall offers.
 *
 * The whole roster, in the library's own order. An earlier cut showed seven on
 * a bundle argument — expressions are values so a consumer ships only the poses
 * it uses (ADR-0002) — and that argument turns out not to apply here: the hero
 * sits on the same page and already imports all fourteen, so withholding half
 * of them from the wall would cost the visitor nothing and buy them nothing
 * either. The wall preview page pays for its own copy, which is a development
 * surface and not a page anyone lands on.
 *
 * What remains is a design question rather than a budget one, and fourteen
 * labelled tiles in a four-across grid is a picker; it is the flat row of
 * fourteen that would have read as a settings screen.
 */
export const FACES: Record<string, Expression> = {
  idle, happy, sad, mad, surprised, wink, sleepy, smug, unsure, scared, love, shy, sick,
  thinking,
};

export const FACE_NAMES = Object.keys(FACES);

/**
 * A stored expression name, resolved for drawing.
 *
 * Falls back to `idle` rather than throwing, because the name arrives from a
 * cached chunk body that may have been written by a version of the wall that
 * offered a face this one no longer does. A blobatar with the wrong face is a
 * blemish; a wall that refuses to draw is an outage.
 */
export const faceOf = (name: string): Expression => FACES[name] ?? idle;
