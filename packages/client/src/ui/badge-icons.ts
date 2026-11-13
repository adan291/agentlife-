import { BADGE_SHAPES } from "@agentlife/shared";
import type { BadgeShape } from "@agentlife/shared";

/**
 * Badge pictures, drawn in code: each shape is a short list of SVG primitives in a 24 by 24 box, built with
 * `createElementNS` (no image files, no markup strings). `$c` stands for the colour of the badge and `$d` for a dark
 * detail colour. The art is our own.
 */
export interface IconPart {
  tag: "path" | "circle" | "rect";
  attrs: Record<string, string>;
}

const DARK = "#0b0a12";
const SVG_NS = "http://www.w3.org/2000/svg";

const fill = (d: string): IconPart => ({ tag: "path", attrs: { d, fill: "$c" } });
const line = (d: string): IconPart => ({ tag: "path", attrs: { d, fill: "none", stroke: "$d", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" } });
const disc = (cx: number, cy: number, r: number, f = "$c"): IconPart => ({ tag: "circle", attrs: { cx: String(cx), cy: String(cy), r: String(r), fill: f } });

export const ICON_PARTS: Readonly<Record<BadgeShape, readonly IconPart[]>> = {
  star: [fill("M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z")],
  moon: [fill("M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z")],
  book: [fill("M4 4.5h6.5q1 0 1.5 1 .5-1 1.5-1H20v14h-6.5q-1 0-1.5 1-.5-1-1.5-1H4z"), line("M12 5.5v13")],
  branch: [disc(6, 5, 2.6), disc(6, 19, 2.6), disc(18, 9, 2.6), { tag: "path", attrs: { d: "M6 7.6v8.8M18 11.6c0 4-6 3.4-12 5", fill: "none", stroke: "$c", "stroke-width": "2", "stroke-linecap": "round" } }],
  check: [disc(12, 12, 9.5), line("M7.5 12.5l3 3 6-6.5")],
  flame: [fill("M12 2.5c1 3.5 5.5 5.5 5.5 11a5.5 5.5 0 0 1-11 0c0-2.2 1-3.6 2-4.8.3 1.4 1 2.2 1.8 2.5C10.2 8.5 11 5.5 12 2.5z")],
  envelope: [{ tag: "rect", attrs: { x: "3", y: "5.5", width: "18", height: "13", rx: "2", fill: "$c" } }, line("M3.8 7.2l8.2 6.3 8.2-6.3")],
  bolt: [fill("M13.5 2L5 13.5h5.5L9.5 22 19 10h-5.8z")],
  crown: [fill("M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z")],
  ghost: [fill("M12 3a7 7 0 0 0-7 7v11l2.3-2 2.3 2 2.4-2 2.4 2 2.3-2 2.3 2V10a7 7 0 0 0-7-7z"), disc(9.5, 10.5, 1.3, "$d"), disc(14.5, 10.5, 1.3, "$d")],
  clock: [disc(12, 12, 9.5), line("M12 6.5V12l3.5 2")],
  medal: [fill("M7.5 2.5h3l1.5 6-4 .5zM16.5 2.5h-3L12 8.5l4 .5z"), disc(12, 14.5, 6.5), disc(12, 14.5, 3, "$d")],
};

/** The drawing of a badge as a small SVG element. `colour` is the badge's `#rrggbb`. */
export function badgeIcon(doc: Document, shape: BadgeShape, colour: string, size = 28): Element {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "al-badge-icon");
  for (const part of ICON_PARTS[shape]) {
    const el = doc.createElementNS(SVG_NS, part.tag);
    for (const [k, v] of Object.entries(part.attrs)) el.setAttribute(k, v === "$c" ? colour : v === "$d" ? DARK : v);
    svg.appendChild(el);
  }
  return svg;
}

/** Every shape the protocol allows has a drawing (checked by a test). */
export const DRAWN_SHAPES: readonly BadgeShape[] = BADGE_SHAPES.filter((s) => ICON_PARTS[s].length > 0);
