/**
 * Everything the screen check and the error watcher accept on purpose. Each entry says why. An entry that nothing
 * matches any more is a candidate for removal: read the list when a rule changes.
 */

export interface Accepted {
  /** The rule of `rules.ts`. */
  rule: string;
  /** Matched against the description of the element (`tag.class "name"`). */
  element: RegExp;
  reason: string;
}

export const ACCEPTED_PROBLEMS: readonly Accepted[] = [
  {
    rule: "clickable-role",
    element: /^div\.al-palette-wrap/,
    reason: "The dim area behind the command palette closes it when clicked. Esc and Ctrl+K do the same from the keyboard, so nothing is lost by it not being a button.",
  },
  {
    rule: "viewport",
    element: /\.al-wisp/,
    reason: "A wisp floats over a tile of the floor. At small windows the stage shows only part of the room and clips the rest, wisps on it included.",
  },
  {
    rule: "text-cut",
    element: /^main\.al-stage/,
    reason: "The room is wider than the stage at 360 px (zoom is 1 or 2, never fitted), and the stage clips it on purpose. A wisp on a tile outside the cut sticks out of it.",
  },
  {
    rule: "tab",
    element: /\.al-wisp/,
    reason: "At small windows a wisp can sit on a tile outside the visible part of the room. It is a bonus, not a control the user needs, and the scan cannot list a control that is clipped away.",
  },
  {
    rule: "covered",
    element: /\.al-wisp/,
    reason: "A wisp floats over the floor where it likes. A panel opened over the floor hides it, and it can be caught again when the panel closes.",
  },
  {
    rule: "covered",
    element: /\.al-wisp/,
    reason: "A wisp floats over the floor where it likes. A panel opened over the floor hides it, and it can be caught again when the panel closes.",
  },
  {
    rule: "cursor",
    element: /\.al-tray-item/,
    reason: "An inventory item is dragged onto the floor (and also picked by a click); its grab cursor says so, which a pointer would not.",
  },
];

/** A console error or page error the journeys accept: matched against its text and, for a failed request, its URL. */
export interface AcceptedMessage {
  text: RegExp;
  url?: RegExp;
  reason: string;
}

export const ACCEPTED_MESSAGES: readonly AcceptedMessage[] = [
  {
    text: /^Failed to load resource/,
    url: /\/favicon\.ico$/,
    reason: "The Vite dev server has no favicon.ico; the page does not ask for another resource that can fail.",
  },
];
