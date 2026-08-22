/**
 * The framework picker, shared by the hero and the editor.
 *
 * Five adapters is where a flat strip stops working — the editor's would have
 * become seven chips in a column narrow enough that they wrap — so the axis
 * folds into a menu and the strip keeps its three slots. It is one component
 * rather than two because the list is the part worth having in one place: a
 * sixth adapter should appear on both pages by landing in `FRAMEWORKS`, not by
 * being remembered twice.
 *
 * The trigger is the caller's, passed as `children` and rendered `asChild`,
 * because the two pages disagree about what a trigger looks like there and
 * neither is wrong: the editor's is a segment of a control strip, the hero's is
 * a bare chip beside a filename. Only the panel is shared.
 */
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { FRAMEWORKS, type Framework } from "@/frameworks";
import { cn } from "@/lib/utils";

export interface FrameworkMenuProps {
  value: Framework;
  onChange: (next: Framework) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The trigger, rendered as the popover's anchor. */
  children: React.ReactNode;
  align?: "start" | "center" | "end";
}

export function FrameworkMenu({
  value,
  onChange,
  open,
  onOpenChange,
  children,
  align = "start",
}: FrameworkMenuProps) {
  return (
    /*
      Controlled, and anchored rather than triggered. Both follow from the same
      thing: on the editor the trigger is also a tab, so a click has two
      meanings — select this framework, or, if it is already selected, open the
      list. Radix's `Trigger` owns the click and would collapse those two into
      one; an `Anchor` only positions, leaving the caller to decide which the
      click was.
    */
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent align={align} sideOffset={8} className="w-40 p-1.5">
        <div role="listbox" aria-label="Framework" className="flex flex-col">
          {FRAMEWORKS.map(f => (
            <button
              key={f.id}
              type="button"
              role="option"
              aria-selected={f.id === value}
              onClick={() => {
                onChange(f.id);
                onOpenChange(false);
              }}
              className={cn(
                "flex items-center justify-between rounded-xl px-3 py-2 text-left",
                "text-xs lowercase transition-colors duration-150",
                "hover:bg-line/60 hover:text-ink",
                f.id === value ? "text-ink" : "text-muted",
              )}
            >
              {f.id}
              {/*
                A dot rather than a checkmark. The row is already the selected
                one by its weight; a tick is a second, louder claim about the
                same fact, and this panel is 40px of a page whose subject is
                somewhere else.
              */}
              {f.id === value ? (
                <span aria-hidden="true" className="bg-ink size-1.5 rounded-full" />
              ) : null}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The affordance on the trigger — a caret, and nothing else.
 *
 * Inline SVG rather than a glyph: `▾` is a character whose baseline and weight
 * are the font's business, and it sits differently in every one of them.
 */
export function Caret({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 8 5"
      className={cn("size-2 transition-transform duration-150", className)}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1 1.25 4 4 7 1.25" />
    </svg>
  );
}
