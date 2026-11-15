import { expect, test as base } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ACCEPTED_MESSAGES } from "./allowlist.ts";
import { startHotel } from "./hotel.ts";
import type { Hotel, HotelSeed } from "./hotel.ts";
import { installClickProbe, screenProblems } from "./rules.ts";

export { expect };

interface Fixtures {
  /** A world-server of this test's own, with scratch files. Started before the test, stopped after it. */
  hotel: Hotel;
}

interface Options {
  /** What the hotel starts with besides the defaults (`test.use({ hotelSeed: ... })`). */
  hotelSeed: HotelSeed;
  /**
   * Page errors and console errors this test causes on purpose (the Bug sack tests throw errors to see them caught). Matched
   * against the text of the error; nothing else is accepted.
   */
  causedErrors: RegExp[];
}

/**
 * `test` for the journeys: the page talks to the test's own hotel, remembers what reacts to a click (for the interface
 * rules) and fails the test at the end if the page raised an error or logged one that `allowlist.ts` does not accept.
 */
export const test = base.extend<Fixtures & Options>({
  hotelSeed: [{}, { option: true }],
  causedErrors: [[], { option: true }],
  hotel: async ({ hotelSeed }, use) => {
    const hotel = await startHotel(hotelSeed);
    try {
      await use(hotel);
    } finally {
      await hotel.stop();
    }
  },
  page: async ({ page, hotel, causedErrors }, use, testInfo) => {
    await page.addInitScript(installClickProbe);
    await hotel.attach(page);
    const errors: string[] = [];
    const caused = (text: string): boolean => causedErrors.some((c) => c.test(text));
    page.on("pageerror", (e) => {
      if (!caused(e.message)) errors.push(`page error: ${e.message}`);
    });
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const accepted = ACCEPTED_MESSAGES.some((a) => a.text.test(m.text()) && (a.url === undefined || a.url.test(m.location().url)));
      if (!accepted && !caused(m.text())) errors.push(`console error: ${m.text()} (${m.location().url})`);
    });
    await use(page);
    // A test that failed already reports its own failure; a second one about the console would only be noise.
    if (testInfo.status === testInfo.expectedStatus) expect(errors, "page errors and console errors").toEqual([]);
  },
});

/** Fails with one line per problem when the screen as it is now breaks a layout or interface rule (`rules.ts`). */
export async function expectScreen(page: Page, name: string): Promise<void> {
  const size = page.viewportSize();
  const problems = await screenProblems(page);
  expect(
    problems.map((p) => `[${p.rule}] ${p.element}: ${p.detail}`),
    `screen "${name}" at ${size ? `${size.width}x${size.height}` : "?"}`,
  ).toEqual([]);
}
