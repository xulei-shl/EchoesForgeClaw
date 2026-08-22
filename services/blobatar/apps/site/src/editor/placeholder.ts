/**
 * The seed the editor renders when the name box is empty.
 *
 * A space, which the library trims to nothing — so this is the empty seed, seen
 * through the same normalization every other name goes through. It is a single
 * constant rather than a `name || " "` at each call site because four places
 * now depend on agreeing: the preview, the resolved layout the sliders read
 * their ghosts from, and both exports. A preview showing one blobatar while the
 * downloaded file holds another would be the one bug this page cannot afford.
 *
 * Deliberately not the same thing as the *placeholder text* in the box. That
 * says "someone"; this renders the empty name. Typing `someone` produces a
 * different blobatar, and it should.
 */
export const PLACEHOLDER_SEED = " ";
