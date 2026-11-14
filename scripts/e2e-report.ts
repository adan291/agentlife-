// Reads the JSON report of a Playwright run (`--reporter=json`) for the conductor.
// A test that failed and then passed on the immediate retry is "flaky": it does not stop a merge, but it is named.

export interface E2eSummary {
  passed: number;
  failed: string[];
  flaky: string[];
  skipped: number;
}

interface JsonSpec { title?: string; file?: string; tests?: { status?: string }[] }
interface JsonSuite { title?: string; suites?: JsonSuite[]; specs?: JsonSpec[] }

/** Walks the suites of a Playwright JSON report and sorts every test into passed, failed, flaky or skipped. */
export function summarizeE2e(report: unknown): E2eSummary {
  const out: E2eSummary = { passed: 0, failed: [], flaky: [], skipped: 0 };
  const root = (report ?? {}) as { suites?: JsonSuite[] };
  const walk = (suite: JsonSuite, path: string[]): void => {
    for (const spec of suite.specs ?? []) {
      const name = `${spec.file ?? ""} > ${[...path, spec.title ?? ""].filter(Boolean).join(" > ")}`.trim();
      for (const t of spec.tests ?? []) {
        if (t.status === "expected") out.passed += 1;
        else if (t.status === "flaky") out.flaky.push(name);
        else if (t.status === "skipped") out.skipped += 1;
        else out.failed.push(name);
      }
    }
    for (const child of suite.suites ?? []) walk(child, [...path, child.title ?? ""]);
  };
  // A top-level suite is a file: its title is its path, and the specs carry the file name already.
  for (const file of root.suites ?? []) walk(file, []);
  return out;
}

/** One line for the session log. */
export function describeE2e(s: E2eSummary): string {
  const parts = [`${s.passed} passed`];
  if (s.flaky.length) parts.push(`${s.flaky.length} flaky (failed, then passed on the retry)`);
  if (s.failed.length) parts.push(`${s.failed.length} failed`);
  if (s.skipped) parts.push(`${s.skipped} skipped`);
  return parts.join(", ");
}
