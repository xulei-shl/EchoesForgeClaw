"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";

// CanvasCard — a holographic 3D card: a white frame around an art box that
// holds a collage of cut-outs (a photo, a round badge, a note, handwriting,
// any extra images), each placed by `layout`. Cut-outs get a die-cut border
// traced from their alpha by the SVG filter below. On hover the card tilts
// toward the pointer and a glitter sheen sweeps across it; the styles live in
// canvas-card.css. Zero dependencies: React + that file.

/** Where an object sits on the art: left/top/width in % of the art box, angle in degrees. */
export type CanvasCardLayout = {
  x: number;
  y: number;
  w: number;
  angle: number;
};
/** The built-in objects; any other key is an image from `images`. */
export type CanvasCardObjectKind =
  "photo" | "badge" | "note" | "writing" | (string & {});
/** Width : height of the built-in objects (placement gives the width, height follows). */
export const CANVAS_CARD_ASPECT: Record<string, number> = {
  photo: 1,
  badge: 1,
  note: 1,
  writing: 200 / 86,
};
/** Which objects sit on the card and where; key order is the stacking order. An absent object is not drawn. */
export type CanvasCardLayouts = Partial<
  Record<CanvasCardObjectKind, CanvasCardLayout>
>;

// The default placements.
export const DEFAULT_LAYOUT: CanvasCardLayouts = {
  note: { x: 6, y: 5, w: 56, angle: -3 },
  photo: { x: 13.5, y: 59, w: 47, angle: -5 },
  skirt: { x: 3.82, y: 73.87, w: 26, angle: 5.1 },
  guitar: { x: 50, y: 68, w: 45, angle: -20 },
  bunny: { x: 3, y: 39.9, w: 22, angle: 8 },
  shorts: { x: 53.09, y: 27.05, w: 34.3, angle: 12 },
  badge: { x: 59.49, y: 11.24, w: 28.57, angle: 6 },
  capybara: { x: 70, y: 38, w: 24, angle: -8 },
  bra: { x: 58.19, y: 61.42, w: 28, angle: 15 },
  book: { x: 75, y: 80, w: 20, angle: 10 },
  glass: { x: 30, y: 48, w: 14, angle: -6 },
  writing: { x: 31.53, y: 44.18, w: 60.21, angle: 4 },
};

/** Inline placement for one object. */
export function place(l: CanvasCardLayout): CSSProperties {
  return {
    left: `${l.x}%`,
    top: `${l.y}%`,
    width: `${l.w}%`,
    transform: `rotate(${l.angle}deg)`,
  };
}

export type CanvasCardProps = {
  photo: string;
  alt?: string;
  /** Max tilt in degrees. */
  tilt?: number;
  /** Die-cut border around the cut-outs (white rim + dark edge). */
  outline?: boolean;
  /** Placement of the objects on the art. */
  layout?: CanvasCardLayouts;
  /** An image shown as a round badge (white rim only). */
  badge?: string;
  /** The note's text; line breaks are kept. */
  note?: string;
  /** The handwriting's URL (an SVG or any transparent image), drawn as ink. */
  writing?: string;
  /** Extra cut-out images by key (transparent PNG/WebP), drawn with the die-cut where `layout` places them. */
  images?: Record<string, string>;
  /** Hold still: no tilt, no glitter. */
  still?: boolean;
  /** Whether the objects are showing up on this load — so a layer of objects outside the card can do the same. */
  onShowUp?: (showUp: boolean) => void;
  className?: string;
};

// Before paint in the browser, a plain effect on the server (where a layout
// effect only warns) — the show-up decision has to be made before the first
// frame or a cached card would blink.
const useBeforePaint =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

const OUTLINE_ID = "canvas-card-outline";
const DEFAULT_NOTE =
  "Creating anything\nI want until I land on\na project that will eat\nmy entire time.";

// The note's icon (24-unit grid), inlined so the component stays self-contained.
const NOTE_ICON =
  "M12.0553 3.00081C12.3317 2.99532 12.5924 3.01523 12.8418 3.05531C13.3871 3.14296 13.9002 2.77197 13.9878 2.22668C14.0755 1.6814 13.7045 1.1683 13.1592 1.08066C12.798 1.0226 12.421 0.993754 12.0255 1.00101C10.0581 1.00401 8.50244 1.89834 7.22865 2.63063L7.13364 2.68523C5.76562 3.47092 4.73699 4.02459 3.52065 3.93698C3.01572 3.90061 2.56327 4.24731 2.46704 4.74432C2.10183 6.63064 1.95451 8.39717 2.01288 10.0355C2.03254 10.5874 2.49592 11.0189 3.04785 10.9993C3.59979 10.9796 4.03128 10.5162 4.01161 9.9643C3.9673 8.72052 4.05455 7.37206 4.28907 5.92066C5.76357 5.77922 7.00199 5.06757 8.06103 4.459L8.1297 4.41954C9.48837 3.63922 10.627 3.001 12.0354 3.001L12.0553 3.00081ZM21.997 11.0841C22.0434 10.5338 21.635 10.0499 21.0847 10.0034C20.5344 9.95697 20.0505 10.3654 20.004 10.9157C19.548 16.314 16.4633 19.709 12.0529 20.9659C11.8078 20.9 11.5753 20.825 11.3481 20.7408C10.8303 20.5488 10.2548 20.813 10.0629 21.3308C9.87087 21.8486 10.135 22.4241 10.6529 22.616C11.0272 22.7548 11.4152 22.8741 11.8334 22.973C11.9934 23.0109 12.1602 23.0087 12.3192 22.9667C17.6743 21.5516 21.461 17.4273 21.997 11.0841ZM6.20659 16.3647C5.42567 16.1076 4.53188 16.2898 3.91094 16.9111C3.033 17.7898 3.03296 19.214 3.9109 20.0926C4.78917 20.9715 6.21402 20.9716 7.09247 20.0926C7.72254 19.4621 7.90054 18.551 7.62654 17.762C7.6469 17.7447 7.66672 17.7264 7.68596 17.7072L9.74117 15.6528L10.7096 16.6212C10.8971 16.8088 11.0025 17.0631 11.0025 17.3283V17.9999C11.0025 18.5522 11.4502 18.9999 12.0025 18.9999C12.5547 18.9999 13.0025 18.5522 13.0025 17.9999V17.3283C13.0025 16.5327 12.6864 15.7696 12.1238 15.207L11.8039 14.8871L19.4781 8.57932C19.6024 8.4772 19.6905 8.33785 19.7295 8.18183L20.7295 4.18183C20.7934 3.92625 20.7185 3.65588 20.5322 3.4696C20.3459 3.28331 20.0756 3.20842 19.82 3.27232L15.82 4.27232C15.6647 4.31115 15.5259 4.39865 15.4239 4.52203L9.09436 12.1776L8.79534 11.8786C8.23273 11.316 7.46967 10.9999 6.67402 10.9999H6.00244C5.45016 10.9999 5.00244 11.4476 5.00244 11.9999C5.00244 12.5522 5.45016 12.9999 6.00244 12.9999H6.67402C6.93923 12.9999 7.19359 13.1053 7.38112 13.2928L8.32696 14.2386L6.27205 16.2926C6.24885 16.3158 6.22703 16.3399 6.20659 16.3647ZM4.97197 19.0323C4.67928 18.7394 4.67927 18.2644 4.97193 17.9714C5.26452 17.6787 5.73887 17.6787 6.03146 17.9714C6.32433 18.2645 6.32432 18.7393 6.03149 19.0323C5.73888 19.325 5.26434 19.3249 4.97197 19.0323Z";

export function CanvasCard({
  photo,
  alt = "",
  tilt = 14,
  outline = true,
  layout = DEFAULT_LAYOUT,
  badge,
  note = DEFAULT_NOTE,
  writing,
  images,
  still = false,
  onShowUp,
  className = "",
}: CanvasCardProps) {
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

  // Show-up: whether the objects are held back at all is decided by the script
  // below, while the page is still being parsed — before anything of the
  // collage can be on screen. Pictures the browser already has are painted with
  // the page, the way they were before any of this; when one still has to come,
  // every object starts as nothing (scale 0 behind 2rem of blur) and each grows
  // into place on its own picture, so they land as they arrive rather than all
  // at one moment. The note is not part of it — it has no picture to wait for.
  const [showUp, setShowUp] = useState(false);
  const showUp$ = useRef(onShowUp);
  useEffect(() => {
    showUp$.current = onShowUp;
  }, [onShowUp]);
  const sources = [photo, badge, writing, ...Object.values(images ?? {})]
    .filter(Boolean)
    .join("\n");
  // Pick up what the script decided (it wrote the attribute; React's own value
  // is only the default) before the first frame this side paints.
  useBeforePaint(() => {
    try {
      sessionStorage.setItem(SEEN_KEY, signature(sources)); // this tab has had them now
    } catch {
      /* no storage — every load shows up */
    }
    if (root.current?.dataset.in !== "wait") return; // painted with the page
    setShowUp(true);
    showUp$.current?.(true);
  }, [sources]);

  // The pointer state is written straight to the elements that use it, in
  // the same frame — the tilt as an inline transform on the card, the light
  // variables (--px/--py/--on) on the three light layers — never as inherited
  // variables on the root: a change there would re-resolve style on every
  // descendant, and WebKit re-runs the cut-outs' SVG filters for that, which
  // is what made the tilt stutter. The idle flag on the root picks the
  // transition: 120ms while following the pointer, the slow settle on leave.
  const parts = useRef<{
    card: HTMLElement | null;
    lights: HTMLElement[];
  } | null>(null);
  function set(
    px: number,
    py: number,
    rx: number,
    ry: number,
    on: 0 | 1,
    idle: boolean,
  ) {
    const el = root.current;
    if (!el) return;
    // Only on change: an attribute write invalidates style below it.
    if (el.dataset.idle !== String(idle)) el.dataset.idle = String(idle);
    parts.current ??= {
      card: el.querySelector<HTMLElement>(".canvas-card-card"),
      lights: Array.from(
        el.querySelectorAll<HTMLElement>(
          ".canvas-card-holo, .canvas-card-ripple, .canvas-card-glare",
        ),
      ),
    };
    const { card, lights } = parts.current;
    if (card)
      card.style.transform = `perspective(60rem) rotateX(${ry.toFixed(2)}deg) rotateY(${rx.toFixed(2)}deg)`;
    for (const layer of lights) {
      layer.style.setProperty("--px", `${px.toFixed(2)}%`);
      layer.style.setProperty("--py", `${py.toFixed(2)}%`);
      layer.style.setProperty("--on", String(on));
    }
  }

  // Following the pointer: the target is eased toward each frame (a lerp in
  // requestAnimationFrame) and written without any CSS transition — re-
  // targeting a transform transition on every mouse event makes WebKit
  // restart an accelerated animation each time, which hitches. The settle on
  // leave is the one place a CSS transition runs (data-idle="true").
  const target = useRef({ px: 50, py: 50, rx: 0, ry: 0 });
  const current = useRef({ px: 50, py: 50, rx: 0, ry: 0 });
  const raf = useRef<number | null>(null);
  function tick() {
    const t = target.current;
    const c = current.current;
    const k = 0.35;
    c.px += (t.px - c.px) * k;
    c.py += (t.py - c.py) * k;
    c.rx += (t.rx - c.rx) * k;
    c.ry += (t.ry - c.ry) * k;
    set(c.px, c.py, c.rx, c.ry, 1, false);
    const done =
      Math.abs(t.rx - c.rx) < 0.01 &&
      Math.abs(t.ry - c.ry) < 0.01 &&
      Math.abs(t.px - c.px) < 0.05 &&
      Math.abs(t.py - c.py) < 0.05;
    raf.current = done ? null : requestAnimationFrame(tick);
  }

  function onMove(e: PointerEvent<HTMLDivElement>) {
    const el = root.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width; // 0…1
    const y = (e.clientY - r.top) / r.height;
    target.current = {
      px: x * 100,
      py: y * 100,
      rx: (x - 0.5) * 2 * tilt,
      ry: (0.5 - y) * 2 * tilt,
    };
    raf.current ??= requestAnimationFrame(tick);
  }

  function onLeave() {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    target.current = { px: 50, py: 50, rx: 0, ry: 0 };
    current.current = { px: 50, py: 50, rx: 0, ry: 0 };
    set(50, 50, 0, 0, 0, true);
  }
  useEffect(
    () => () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    },
    [],
  );

  // Going still mid-hover settles right away.
  useEffect(() => {
    if (still) onLeave();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onLeave is stable in effect (refs only)
  }, [still]);

  return (
    // The outer element never transforms, so the pointer's hit area stays put
    // while the card inside tilts. Touch works the same: a finger down and
    // moving tilts the card, lifting it settles (touch-action: none in the CSS).
    <div
      ref={root}
      id={id}
      suppressHydrationWarning // the script below may set data-in before React sees it
      data-idle="true"
      data-in={showUp ? "wait" : "in"}
      onPointerMove={still ? undefined : onMove}
      onPointerLeave={still ? undefined : onLeave}
      onPointerDown={still ? undefined : onMove}
      onPointerUp={still ? undefined : onLeave}
      onPointerCancel={still ? undefined : onLeave}
      className={`canvas-card ${className}`}
    >
      <div className="canvas-card-card">
        <div className="canvas-card-art">
          {outline && (
            <>
              <OutlineDefs id={OUTLINE_ID} />
              <OutlineDefs id={`${OUTLINE_ID}-badge`} dark={false} />
            </>
          )}
          <div className="canvas-card-paste">
            {Object.keys(layout).map((kind) => {
              const l = layout[kind];
              return l ? (
                <CanvasCardObject
                  key={kind}
                  kind={kind}
                  layout={l}
                  photo={photo}
                  alt={alt}
                  badge={badge}
                  note={note}
                  writing={writing}
                  images={images}
                  outline={outline}
                />
              ) : null;
            })}
          </div>
          <div className="canvas-card-ripple" />
          <div className="canvas-card-holo" />
          <div className="canvas-card-holo canvas-card-holo-2" />
          <div className="canvas-card-glare" />
        </div>
      </div>
      {/* Runs as the browser parses this, before the collage can be painted:
          any picture it cannot hand over on the spot means none of them is
          drawn yet — the objects wait and show up together (see above). A
          picture the browser already holds is painted with the page, so a
          reload has no show-up at all. The timeout is the failsafe for a page
          whose JS never arrives. */}
      <script
        // text/javascript in the HTML the server writes (the browser runs it on
        // the way past), text/plain when React renders this on the client, where
        // a script never runs anyway and React logs an error for trying
        type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: showUpScript(id, sources) }}
      />
    </div>
  );
}

/* What the browser has already fetched cannot be asked for on the spot — an
   Image whose file is in the cache still reports itself incomplete for a tick.
   So the card remembers, per tab, that it has had these pictures once: the
   first load of a tab shows them up, every reload after it paints them with
   the page. The key is the pictures themselves, so a changed collage shows up
   again. */
const SEEN_KEY = "canvas-card:seen";
const signature = (sources: string) => {
  let h = 0;
  for (let i = 0; i < sources.length; i++)
    h = (Math.imul(31, h) + sources.charCodeAt(i)) | 0;
  return `${h}`;
};

/* The show-up decision, as it runs in the page while it is being parsed. */
function showUpScript(id: string, sources: string) {
  const urls = JSON.stringify(sources.split("\n").filter(Boolean));
  return `{var n=document.getElementById(${JSON.stringify(id)}),s=0;try{s=sessionStorage.getItem(${JSON.stringify(SEEN_KEY)})===${JSON.stringify(signature(sources))}}catch(e){}if(n&&!s&&!${urls}.every(function(u){var i=new Image();i.src=u;return i.complete})){n.dataset.in="wait";setTimeout(function(){if(n.dataset.in==="wait")n.dataset.in="in"},8000)}}`;
}

/* An object is there once its own picture is: the attribute is written straight
   to the element (no re-render for a picture landing), which is also why it
   starts as "wait" in the markup — the very first paint must not show an object
   whose file has not arrived. A picture the browser already had is marked on
   the spot, in the ref, before that paint. */
function showUp(object?: HTMLElement | null, picture?: HTMLImageElement | null) {
  if (!object || !picture) return;
  if (picture.complete && picture.naturalWidth) object.dataset.in = "in";
}
const showUpProps = () => ({
  "data-in": "wait",
  suppressHydrationWarning: true,
  ref: (el: HTMLImageElement | null) => showUp(el, el),
  onLoad: (e: { currentTarget: HTMLImageElement }) =>
    showUp(e.currentTarget, e.currentTarget),
  onError: (e: { currentTarget: HTMLImageElement }) =>
    showUp(e.currentTarget, e.currentTarget),
});

// One collage object, placed by its layout (% of the box it sits in): a
// built-in kind, or any key of `images`.
export function CanvasCardObject({
  kind,
  layout,
  photo,
  alt = "",
  badge,
  note = DEFAULT_NOTE,
  writing,
  images,
  outline = true,
}: {
  kind: CanvasCardObjectKind;
  layout: CanvasCardLayout;
  photo?: string;
  alt?: string;
  badge?: string;
  note?: string;
  writing?: string;
  images?: Record<string, string>;
  outline?: boolean;
}) {
  const shadow = "drop-shadow(0 2px 3px rgb(15 23 42 / 0.18))";
  // A cut-out image: the die-cut filter `id`, then a soft shadow.
  const cut = (src: string, a: string, id: string) => (
    <img
      src={src}
      alt={a}
      draggable={false}
      className="canvas-card-photo"
      {...showUpProps()}
      style={{
        ...place(layout),
        filter: `${outline ? `url(#${id}) ` : ""}${shadow} blur(var(--canvas-card-in, 0rem))`,
      }}
    />
  );
  if (kind === "writing") {
    if (!writing) return null;
    // A plain <img>, like every other piece: an <svg> pulling the file in with
    // <use> loads it as a document of its own, which lands a beat after the
    // pictures — the ink blinked in on its own, even on a cached reload.
    return (
      <img
        src={writing}
        alt=""
        draggable={false}
        className="canvas-card-writing"
        {...showUpProps()}
        style={place(layout)}
      />
    );
  }
  if (kind === "note") {
    // A container: everything inside is sized in cqw, so it scales with its width.
    return (
      <div className="canvas-card-note" style={place(layout)}>
        <div className="canvas-card-note-card">
          <div className="canvas-card-note-panel">
            <svg
              className="canvas-card-note-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                fill="currentColor"
                fillRule="evenodd"
                clipRule="evenodd"
                d={NOTE_ICON}
              />
            </svg>
            <p className="canvas-card-note-text">{note}</p>
          </div>
        </div>
      </div>
    );
  }
  if (kind === "badge") {
    if (!badge) return null;
    return (
      <div
        className="canvas-card-badge"
        data-in="wait"
        suppressHydrationWarning
        style={{
          ...place(layout),
          filter: `${outline ? `url(#${OUTLINE_ID}-badge) ` : ""}${shadow} blur(var(--canvas-card-in, 0rem))`,
        }}
      >
        <img
          src={badge}
          alt=""
          draggable={false}
          className="canvas-card-badge-img"
          ref={(el) => showUp(el?.parentElement, el)}
          onLoad={(e) => showUp(e.currentTarget.parentElement, e.currentTarget)}
          onError={(e) => showUp(e.currentTarget.parentElement, e.currentTarget)}
        />
      </div>
    );
  }
  if (kind === "photo") return photo ? cut(photo, alt, OUTLINE_ID) : null;
  const src = images?.[kind];
  return src ? cut(src, "", OUTLINE_ID) : null;
}

// The die-cut filter: the silhouette (alpha), softened and re-hardened so the
// cut is one smooth path, then dilated twice — a white rim and a thin dark
// edge outside it — stacked under the graphic. Everything is in CSS px
// (userSpaceOnUse), so the rim (≈2px), the dark edge (≈1.25px) and the
// anti-aliasing stay the same crisp width whatever the object's size.
// `dark={false}` keeps just the white rim.
function OutlineDefs({ id, dark = true }: { id: string; dark?: boolean }) {
  return (
    <svg
      width="0"
      height="0"
      aria-hidden="true"
      className="canvas-card-outline-defs"
    >
      <filter
        id={id}
        filterUnits="objectBoundingBox"
        primitiveUnits="userSpaceOnUse"
        x="-0.3"
        y="-0.3"
        width="1.6"
        height="1.6"
      >
        <feGaussianBlur in="SourceAlpha" stdDeviation="1.4" />
        <feComponentTransfer result="shape">
          <feFuncA type="linear" slope="30" intercept="-12" />
        </feComponentTransfer>
        {/* the dark edge */}
        <feMorphology in="shape" operator="dilate" radius="3.5" />
        <feGaussianBlur stdDeviation="1" />
        <feComponentTransfer result="edge">
          <feFuncA type="linear" slope="4" intercept="-1.2" />
        </feComponentTransfer>
        <feFlood floodColor="#0f172a" floodOpacity={dark ? 0.9 : 0} />
        <feComposite in2="edge" operator="in" result="dark" />
        {/* the white rim */}
        <feMorphology in="shape" operator="dilate" radius="2.25" />
        <feGaussianBlur stdDeviation="1" />
        <feComponentTransfer result="rim">
          <feFuncA type="linear" slope="4" intercept="-1.2" />
        </feComponentTransfer>
        <feFlood floodColor="#ffffff" />
        <feComposite in2="rim" operator="in" result="white" />
        <feMerge>
          <feMergeNode in="dark" />
          <feMergeNode in="white" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </svg>
  );
}
