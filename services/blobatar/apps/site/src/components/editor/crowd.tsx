import { Blobatar } from "@blobatar/react";
import { type TraitOverrides } from "blobatar";
import { NAMES } from "@/names";
import { cn } from "@/lib/utils";

/**
 * Other names under the same config.
 *
 * The page has one preview and a config that does not describe one blobatar. A
 * pinned axis is fixed for everybody and a narrowed one is not — so a config
 * narrowed to three silhouettes renders three different creatures, of which the
 * preview shows whichever one the name in the box happens to land on. Without
 * this row that fact is something the copy has to *claim*; with it, it is
 * something you can see.
 *
 * Not a catalogue of what was selected. The picker rows are already that — ten
 * tiles and six chips, each one showing its own outcome — and a second reading
 * of the same set would be the more useful one to build only if the chips were
 * missing. This is the other question: not "what did I choose" but "what does a
 * list of my users look like if I ship this". So it is a *sample* — the first
 * few names off the list, whatever they come out as — and it is allowed to miss
 * a selected silhouette entirely, because so is any real signup sheet.
 *
 * Shown whether or not anything is narrowed, and that is the same argument. An
 * unpinned axis varies per name too; a row that appeared only once you narrowed
 * something would be a gadget attached to one feature rather than the second
 * half of the preview.
 */

/** Enough that variety reads as variety, few enough to stay one line. */
const SIZE = 7;

/**
 * A stride, not a slice.
 *
 * `NAMES` is alphabetical, so seven consecutive entries are "elena, elias,
 * elin, emeka" — which reads as a fragment of a list rather than as a crowd,
 * and the resemblance is the first thing the eye finds in a row of faces. 17 is
 * coprime with the list's 142, so the walk stays distinct however far it runs.
 */
const STRIDE = 17;

/**
 * Where the walk starts, from the name itself.
 *
 * Derived rather than held in state, which buys two things at once: the row is
 * steady while you tune — the whole point, since a crowd that reshuffled on
 * every slider drag would be impossible to compare against itself — and it
 * turns over on shuffle for free, because shuffle *is* a new name. FNV-1a
 * because it is four lines; nothing here needs the library's hash, and reaching
 * for it would mean exporting one.
 */
const offset = (name: string) => {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  }
  return (h >>> 0) % NAMES.length;
};

/** The sample, minus the name already on screen — a duplicate of the preview says nothing. */
export const crowd = (name: string): string[] => {
  const at = offset(name);
  return Array.from(
    { length: SIZE + 1 },
    (_, i) => NAMES[(at + i * STRIDE) % NAMES.length]!,
  )
    .filter(n => n !== name)
    .slice(0, SIZE);
};

export function Crowd({
  name,
  pinned,
  onPick,
  className,
}: {
  name: string;
  /** The same map the preview carries, so this row is the config and not an echo of it. */
  pinned: TraitOverrides;
  onPick: (name: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <span className="text-muted/60 text-[0.7rem] lowercase">
        other names, same config
      </span>
      <div className="flex flex-wrap justify-center gap-1">
        {crowd(name).map(other => (
          <button
            key={other}
            type="button"
            onClick={() => onPick(other)}
            title={other}
            aria-label={`Preview ${other}`}
            className={cn(
              "rounded-xl p-1 transition-colors duration-150",
              "hover:bg-line/40 focus-visible:bg-line/40 outline-none",
            )}
          >
            {/*
              Static, whatever the motion toggle says. Seven live SVG trees
              beside the blobatar you are watching is seven things competing
              with it — the picker tiles settled this already — and the motion
              control is a statement about the snippet, not about this row.
            */}
            <Blobatar name={other} traits={pinned} alt="" className="size-8" />
          </button>
        ))}
      </div>
    </div>
  );
}
