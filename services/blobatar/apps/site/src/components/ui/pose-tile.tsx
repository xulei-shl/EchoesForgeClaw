import { forwardRef } from "react";
import { Blobatar } from "@blobatar/react";
import type { BlobatarOptions } from "blobatar";
import type { Expression } from "blobatar/expression";
import { cn } from "@/lib/utils";

/**
 * One face in an expression picker: the blobatar wearing the pose, and the
 * pose's name under it.
 *
 * The blobatar rather than a label alone, because a pose is a *look* and the
 * only honest label for a look is the look — "mad" on two capsule eyes means
 * nothing until you have seen it. Seeded with whatever the picker is picking
 * for, so a grid reads as one creature's range rather than as fourteen
 * strangers.
 *
 * Lifted out of the hero when the wall needed the same control. It is the same
 * tile in both places by construction now, rather than by two people
 * remembering to keep them alike.
 *
 * `labelled` is the one thing they disagree about, and it is a width argument
 * rather than a taste one: the hero's picker is a four-across grid with room
 * for a word under each face, and the wall's is fourteen faces in a strip about
 * as wide as a phone. Fourteen mono captions in that space is a paragraph of
 * noise over what is meant to read as a row of expressions.
 */
export const PoseTile = forwardRef<
  HTMLButtonElement,
  {
    name: string;
    expression: Expression;
    seed: string;
    opts?: BlobatarOptions;
    selected: boolean;
    labelled?: boolean;
    onClick: () => void;
  }
  // A forwarded ref because the wall's strip scrolls: the panel has to be able
  // to bring the selected tile into view, and the only thing that can do that
  // is the button itself.
>(function PoseTile({ name, expression, seed, opts, selected, labelled = true, onClick }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      // The pose's name is the accessible name whether or not it is drawn: a
      // picker of pictures still has to be usable by something that cannot see
      // them, and unlabelled it would otherwise be fourteen identical buttons.
      aria-label={labelled ? undefined : name}
      title={labelled ? undefined : name}
      className={cn(
        "flex shrink-0 flex-col items-center gap-1 rounded-xl transition-colors duration-150",
        labelled ? "py-2" : "p-1.5",
        // Unlabelled, the selection has to carry entirely on the tile, so it is
        // a ring rather than the faint fill that reads fine under a caption.
        selected
          ? labelled
            ? "bg-line/70"
            : "bg-line/70 ring-ink/60 ring-1"
          : "hover:bg-line/30",
      )}
    >
      {/* A space, not an empty string: an unnamed blobatar still has to render
          something, and the seed is what decides which something. */}
      {/* Bigger unlabelled than labelled: without a caption under it the tile
          *is* the blobatar, and at 40px fourteen of them read as a row of dots
          rather than as fourteen expressions. */}
      <Blobatar
        name={seed || " "}
        {...opts}
        expression={expression}
        alt=""
        className={labelled ? "size-10" : "size-14"}
      />
      {labelled && (
      <span
        className={cn(
          "font-mono text-[0.65rem] lowercase transition-colors",
          selected ? "text-ink" : "text-muted",
        )}
      >
        {name}
      </span>
      )}
    </button>
  );
});
