/** Night palette: deep purples, teal, pumpkin orange accents. Every colour in the client comes from here. */
export const PALETTE = {
  background: 0x0b0a12,

  floorA: 0x2b2247,
  floorB: 0x241c3c,
  floorEdge: 0x3b2f62,
  floorSide: 0x1a1430,

  wallLeft: 0x1f1936,
  wallRight: 0x281f45,
  wallStripe: 0x120e22,
  wallTrim: 0x4d3b80,
  baseboard: 0x35285c,

  doorDark: 0x0d0a18,
  doorGlow: 0xff8a1f,

  windowFrame: 0x5a4796,
  windowSky: 0x101a3a,
  windowGlow: 0x1d3a5a,
  moon: 0xf3ecc8,

  hoverFloor: 0xff8a1f,
  hoverUse: 0x2fd4c2,

  teal: 0x2fd4c2,
  pumpkin: 0xff8a1f,
  purple: 0xb06bff,
  lilac: 0xe8e0ff,

  text: 0xe8e0ff,
  textDim: 0x9a8fc4,
  tagBg: 0x14101f,
  tagBorder: 0x4d3b80,
  bubbleBg: 0xf4efff,
  bubbleText: 0x1a1030,

  skin: 0xd8cdee,
  eye: 0x1a1030,
  shadow: 0x000000,
} as const;

/** Furniture colours. */
export const FURNI_COLOURS = {
  wood: 0x5c3d6e,
  woodDark: 0x3f2a4e,
  metal: 0x4a5a78,
  screen: 0x2fd4c2,
  screenOff: 0x0e1424,
  deskArchitect: 0x2a6f6a,
  deskDeveloper: 0x8a4a1a,
  deskQa: 0x5a3a8a,
  cork: 0x2b2140,
  note1: 0x2fd4c2,
  note2: 0xff8a1f,
  note3: 0xb06bff,
  mailbox: 0x6a4aa8,
  mailboxFlag: 0xff8a1f,
  pot: 0x8a4a1a,
  leafDark: 0x1f6b4a,
  leafLight: 0x2fb87a,
  lampShade: 0xffd58a,
  lampGlow: 0xffb347,
  sofa: 0x7a2f6a,
  sofaLight: 0x9a4a88,
  chair: 0x4d3b80,
  pumpkin: 0xff8a1f,
  pumpkinDark: 0xc4560a,
  stem: 0x3a8a4a,
  pumpkinFace: 0xffe27a,
  web: 0xd8d0f0,
} as const;

/** Role colours for name tags and avatar bodies. */
export const ROLE_COLOURS = {
  architect: 0x2fd4c2,
  developer: 0xff8a1f,
  qa: 0xb06bff,
  builder: 0xc9b6ff,
  hr: 0xff7eb6,
  user: 0xe8e0ff,
} as const;

export type RoleKey = keyof typeof ROLE_COLOURS;

export const HAIR_COLOURS: Record<RoleKey, number> = {
  architect: 0x1a5f5a,
  developer: 0x5a2a0a,
  qa: 0x3a2060,
  builder: 0x5a4a8a,
  hr: 0x6a2a4a,
  user: 0x6a6090,
};

/** Status badge colours (background of the round icon). */
export const STATE_COLOURS = {
  idle: 0x6a6090,
  walking: 0x2fa86a,
  thinking: 0x7b4fd0,
  working: 0xff8a1f,
  waiting_approval: 0xe0b020,
  blocked: 0xd03a4a,
  done: 0x2fa86a,
  error: 0xd03a4a,
} as const;

/** Multiply an RGB colour by a factor (< 1 darkens, > 1 lightens, clamped). */
export function shade(colour: number, factor: number): number {
  const r = Math.min(255, Math.round(((colour >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((colour >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((colour & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}

function linear(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a 0xRRGGBB colour. */
export function luminanceOf(colour: number): number {
  return 0.2126 * linear((colour >> 16) & 0xff) + 0.7152 * linear((colour >> 8) & 0xff) + 0.0722 * linear(colour & 0xff);
}

/** WCAG contrast ratio of two 0xRRGGBB colours, 1 to 21. */
export function contrastOf(a: number, b: number): number {
  const la = luminanceOf(a);
  const lb = luminanceOf(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** White or the dark tag colour, whichever reads better on `background` (status icons sit on bright and on dark discs). */
export function glyphColourOn(background: number): number {
  return contrastOf(0xffffff, background) >= contrastOf(PALETTE.tagBg, background) ? 0xffffff : PALETTE.tagBg;
}
