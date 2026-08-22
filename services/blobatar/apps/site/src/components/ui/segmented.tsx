import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "@/lib/utils";

/**
 * A single-select segmented control, in shadcn's idiom over Radix's
 * ToggleGroup.
 *
 * Single-select rather than shadcn's default multi: every axis it drives here
 * (variant, background) is exclusive, and Radix's `type="single"` is what makes
 * arrow keys move between options rather than tab-stopping on each.
 */
function Segmented({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> & { type: "single" }) {
  return (
    <ToggleGroupPrimitive.Root
      className={cn("border-line inline-flex items-center gap-px rounded-full border p-px", className)}
      {...props}
    />
  );
}

function SegmentedItem({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      className={cn(
        "text-muted rounded-full px-3.5 py-1.5 text-xs tracking-wide lowercase",
        "transition-colors duration-150",
        "hover:text-ink data-[state=on]:bg-ink data-[state=on]:text-ground",
        className,
      )}
      {...props}
    />
  );
}

export { Segmented, SegmentedItem };
