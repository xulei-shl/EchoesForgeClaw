/**
 * The page's second deliverable.
 *
 * The snippet is the first and still the important one: it names a seed and the
 * axes you pinned, and whoever runs it re-derives the blobatar. An export is the
 * opposite kind of thing — already derived, and never derivable again. It
 * carries no seed, no overrides and no generation, so the moment it is saved it
 * stops tracking the library: when the default generation moves, every snippet
 * ever copied keeps rendering the right blobatar for its major, and every
 * exported file quietly becomes a picture of one that is no longer rendered.
 *
 * That is a fair trade for the person who wants a PNG for a slide, and it is
 * the whole reason this is an *export* rather than a second way to get a
 * blobatar.
 *
 * It lives in the snippet column's header, beside the API tabs, and not under
 * the preview where it started. Two reasons, and the second is the real one.
 * A labelled pill is the largest thing on that side of the page for the
 * smallest thing anybody does there. And it had been wedged between the
 * blobatar and the crowd row, which are deliberately adjacent — the crowd is
 * the same preview asked of seven other names, and it only reads that way while
 * it is touching the preview it varies.
 *
 * Beside the tabs rather than inside the code box, because the box's copy icon
 * is scoped to the tab you are on and a download icon next to it would read as
 * downloading *that* — which is nothing, on the react tab. Out in the header it
 * is what it is: leave with the code, or leave with a file.
 *
 * Static in the rendering-mode sense — never animated. Not in the other sense
 * the word carries around here: an export is a fully *configured* blobatar too,
 * and the two meanings collide badly enough that `CONTEXT.md` keeps them apart.
 */
import { useEffect, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PLACEHOLDER_SEED } from "@/editor/placeholder";
import { cn } from "@/lib/utils";
import type { Motion } from "@/editor/snippet";
import { blobatar, type TraitOverrides } from "blobatar";

/**
 * The one size a raster export can be, since a PNG has to pick one.
 *
 * Large enough to survive being dropped into a slide at whatever size anyone
 * uses it at, small enough that the canvas round-trip is imperceptible.
 */
const PNG_SIZE = 512;

export interface ExportMenuProps {
  name: string;
  traits: TraitOverrides;
  motion: Motion;
}

export function ExportMenu({ name, traits, motion }: ExportMenuProps) {
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => () => clearTimeout(timer.current ?? undefined), []);

  const seed = name || PLACEHOLDER_SEED;
  const file = filename(name);

  /**
   * No `size`.
   *
   * The library emits `width`/`height` only when asked, and an SVG that was not
   * asked scales to whatever it is dropped into — which is the reason to take
   * the vector one at all. Baking 512 in would make the export answer a
   * question the format does not have to answer. The PNG is the one that has to
   * pick.
   */
  function exportSvg() {
    save(svgBlob(blobatar(seed, { traits })), `${file}.svg`);
  }

  /**
   * Here `size` is not a preference but a requirement: an SVG loaded through a
   * blob URL has no intrinsic size in Firefox without `width`/`height`, and
   * `drawImage` of a sizeless image is a blank canvas rather than an error.
   */
  async function exportPng() {
    const url = URL.createObjectURL(svgBlob(blobatar(seed, { traits, size: PNG_SIZE })));
    try {
      const image = await loadImage(url);
      const canvas = document.createElement("canvas");
      canvas.width = PNG_SIZE;
      canvas.height = PNG_SIZE;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no 2d context");
      context.drawImage(image, 0, 0, PNG_SIZE, PNG_SIZE);
      save(await canvasBlob(canvas), `${file}.png`);
    } catch {
      // Unlike a refused clipboard, there is nothing on screen that stands in
      // for the file — a silent failure here is a button that does nothing. Say
      // so, briefly, and point at the SVG path, which cannot fail this way.
      setFailed(true);
      clearTimeout(timer.current ?? undefined);
      timer.current = setTimeout(() => setFailed(false), 2400);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-haspopup="menu"
          aria-label="Export this blobatar"
          title="Export"
          className={cn(
            "text-muted hover:text-ink hover:bg-line/50 flex size-7 cursor-pointer items-center justify-center",
            "rounded-lg transition-colors duration-150",
          )}
        >
          <DownloadIcon />
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" sideOffset={8} className="w-56 p-2" role="menu">
        {/*
          Both formats as menu items, where the split button had SVG promoted to
          a labelled default. Out here there is no room to promote anything, and
          nothing to promote: the two are a choice between vector and raster,
          not a default and its alternative.
        */}
        <Item label="SVG" note="scales to any size" onClick={exportSvg} />
        <Item label="PNG" note={`${PNG_SIZE} × ${PNG_SIZE} image`} onClick={exportPng} />

        {/*
          Only when motion is on. A note explaining that exports are static,
          sitting under a preview that is already holding still, would be
          answering a question nobody asked.
        */}
        {motion && (
          <p className="text-muted border-line mt-2 border-t px-3 pt-3 text-xs leading-relaxed">
            Motion is preview-only. Exports are static.
          </p>
        )}

        {/*
          In the menu rather than the header row, because the header has no
          space for a line of text that is empty almost always — and because
          this is where the click that failed happened. The popover stays open
          on a click, so the message lands somewhere still on screen.
        */}
        <p aria-live="polite" className="text-muted mt-2 px-3 text-xs empty:hidden">
          {failed ? "Could not encode the PNG — the SVG still works." : ""}
        </p>
      </PopoverContent>
    </Popover>
  );
}

function Item({
  label,
  note,
  onClick,
}: {
  label: string;
  note: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="hover:bg-line/60 flex w-full cursor-pointer flex-col rounded-xl px-3 py-2.5 text-left transition-colors"
    >
      <span className="text-sm">{label}</span>
      <span className="text-muted text-xs">{note}</span>
    </button>
  );
}

const svgBlob = (svg: string) => new Blob([svg], { type: "image/svg+xml;charset=utf-8" });

function save(blob: Blob, as: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = as;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * A label, not an identifier.
 *
 * Worth being explicit about, because it looks like one: `A B` and `A-B` are
 * two different blobatars that land on the same filename, and a name with five
 * axes pinned exports under the same name as that name with none. Encoding the
 * config would fix both and produce filenames nobody wants to see in a
 * downloads folder. The file is the picture you were just looking at; the
 * snippet is the thing that identifies it.
 *
 * Its normalization is its own — NFC and whitespace, for the filesystem — and
 * deliberately not the seed's. Case survives here, because `Alain` and `alain`
 * are one blobatar but whoever typed the first would not recognise a file named
 * after the second.
 */
function filename(name: string) {
  const safe = name
    .trim()
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return safe ? `blobatar-${safe}` : "blobatar";
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("could not load the SVG for raster export"));
    image.src = src;
  });
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error("could not encode PNG"))), "image/png");
  });
}

function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-4"
    >
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  );
}

