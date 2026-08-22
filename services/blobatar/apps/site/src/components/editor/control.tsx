import { Slider } from "@/components/ui/slider";
import { bandIndex, bandValue, round3, type Axis } from "@/editor/axes";
import { cn } from "@/lib/utils";

/**
 * One axis: a label, a number, a track, and a pin.
 *
 * The pin is the whole interaction model. An unpinned axis still has a value —
 * the one the name produced — and the row shows it, greyed, so the panel reads
 * as the blobatar's current state rather than as an empty form. Touching the
 * track pins it, because there is no way to *move* a value that comes from a
 * hash without replacing it, and making that require two gestures would be
 * ceremony. Pinned axes are the ones that appear in the snippet.
 */
export interface ControlProps {
  axis: Axis;
  /** Where the axis currently sits, pinned or hashed. Always in [0, 1). */
  value: number;
  pinned: boolean;
  /** Where the layout resolved it, when `fit` pulled it back. */
  ghost?: number;
  onChange: (v: number) => void;
  onPin: () => void;
}

const fmt = (v: number) => v.toFixed(3);

export function Control({
  axis,
  value,
  pinned,
  ghost,
  onChange,
  onPin,
}: ControlProps) {
  const label = `${axis.group} ${axis.label}`;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span
          className={cn(
            "text-[0.75rem] lowercase transition-colors",
            pinned ? "text-ink" : "text-muted",
          )}
        >
          {axis.label}
        </span>

        <span className="flex items-baseline gap-1.5 font-mono text-[0.7rem]">
          {/*
            The number is the one the snippet will contain, to the digit. That
            is deliberate and it is why there are no friendlier units here — a
            hue in degrees would read better and would be a second number to
            reconcile against the one in the box below.
          */}
          <span className={pinned ? "text-ink" : "text-muted/60"}>{fmt(value)}</span>

          {ghost !== undefined && (
            /*
              What actually got drawn. Only ever present when the eye cluster
              was scaled to stay inside the body, which is the case where the
              slider's last third stops moving — an unexplained dead zone reads
              as a broken control, and this is the sentence that turns it into
              a limit.
            */
            <span className="text-muted/60" title="resolved — the eyes were scaled to fit">
              → {fmt(ghost)}
            </span>
          )}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {axis.bands ? (
          <Slider
            aria-label={label}
            data-unpinned={!pinned}
            min={0}
            max={axis.bands - 1}
            step={1}
            value={[bandIndex(value, axis.bands)]}
            onValueChange={([i]) => onChange(bandValue(i!, axis.bands!))}
          />
        ) : (
          <Slider
            aria-label={label}
            data-unpinned={!pinned}
            min={0}
            // Not 1: the library clamps exactly 1 down to 0.999999, so a slider
            // that can reach it emits a value the layout will quietly rewrite —
            // and the snippet would then say something the blobatar disagrees
            // with. The top of the range is the top of what a trait can state.
            max={0.999}
            step={0.001}
            value={[round3(value)]}
            onValueChange={([v]) => onChange(v!)}
            ghost={ghost}
          />
        )}

        <PinButton pinned={pinned} label={label} onClick={onPin} />
      </div>
    </div>
  );
}

function PinButton({
  pinned,
  label,
  onClick,
}: {
  pinned: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pinned}
      // The accessible name carries the consequence rather than the mechanism.
      // "Pin" is what the button does; being in the snippet is why anyone does
      // it, and shuffle skipping the axis is the other half of the same state.
      aria-label={`${pinned ? "Unpin" : "Pin"} ${label} — pinned axes are the ones in the snippet`}
      title={pinned ? "Pinned — in the snippet, held by shuffle" : "Pin this axis"}
      className={cn(
        "shrink-0 rounded-lg p-1 transition-colors duration-150",
        pinned ? "text-ink" : "text-muted/50 hover:text-ink hover:bg-line/50",
      )}
    >
      <PinIcon open={!pinned} />
    </button>
  );
}

/**
 * A padlock, open or shut, drawn as one path pair so the two states are the
 * same mark rather than two icons — the shackle straightens and lifts, the body
 * does not move. Same 1.7px outline the rest of the page's icons use.
 */
function PinIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-[0.95rem]"
    >
      <rect x="5" y="11" width="14" height="9.5" rx="2.5" />
      <path d={open ? "M8.5 11V7.5a3.5 3.5 0 0 1 6.8-1.2" : "M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11"} />
    </svg>
  );
}
