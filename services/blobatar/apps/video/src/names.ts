/**
 * The crowd.
 *
 * Handles and addresses rather than random strings, because the shot is making
 * a claim about a user list and a grid of `x7f2a91` would be making a claim
 * about a hash function. Length and form vary for the same reason real ones do.
 *
 * The hero's cell is filled from `HERO` in `timeline.ts`, not from this list —
 * `crowd()` skips that index. `scripts/check-crowd.ts` verifies no blobatar
 * next to the hero shares its shape band and hue closely enough to be confused
 * with it when the camera comes back down.
 */

export const CROWD = [
  "ada", "grace", "linus", "margaret", "katherine", "dorothy", "alan", "edsger",
  "barbara", "donald", "leslie", "tony", "niklaus", "john", "ken", "dennis",
  "bjarne", "guido", "yukihiro", "rasmus", "brendan", "james", "anders", "rich",
  "jose@acme.com", "mira@acme.com", "tom@acme.com", "sana@acme.com",
  "olu@acme.com", "kim@acme.com", "raj@acme.com", "eve@acme.com",
  "nils@hey.io", "pia@hey.io", "abel@hey.io", "quinn@hey.io", "wren@hey.io",
  "ivo@hey.io", "juno@hey.io", "lark@hey.io",
  "m.torres", "a.okafor", "s.nakamura", "l.dubois", "p.novak", "r.silva",
  "c.andersen", "d.rossi", "f.mueller", "h.kowalski", "j.ferreira", "k.bergman",
  "nina", "kai", "zed", "svg", "fox", "ines", "noa", "sam", "yuki", "sora",
  // `tessa`, not `tess`: `tess` is a round at hue 233 and lands adjacent to the
  // hero, three degrees away from it. See `scripts/check-crowd.ts`.
  "omar", "luca", "rosa", "pablo", "tessa", "uma", "vic", "wes", "yara", "ivy",
  "leo", "mia", "zoe", "eli", "ana", "dan", "max", "tom",
  "hello", "world", "team", "bot", "admin", "guest", "root", "dev", "ops",
  "design", "support", "billing", "sales", "hiring", "press",
  "north", "ember", "cobalt", "willow", "harbor", "juniper", "atlas", "orbit",
  "pixel", "cinder", "meadow", "quartz", "signal", "thistle", "vellum",
  "wander", "zephyr", "basalt", "cadence", "drift", "flint", "gossamer",
  "halcyon", "isthmus",
] as const;
