import { describe, expect, it } from "vitest";
import { describeE2e, summarizeE2e } from "../e2e-report.ts";

const report = {
  suites: [
    {
      title: "journeys.spec.ts",
      specs: [{ title: "lobby", file: "journeys.spec.ts", tests: [{ status: "expected" }] }],
      suites: [
        {
          title: "at 360x640",
          specs: [
            { title: "shop", file: "journeys.spec.ts", tests: [{ status: "flaky" }] },
            { title: "list", file: "journeys.spec.ts", tests: [{ status: "unexpected" }] },
            { title: "visuals", file: "journeys.spec.ts", tests: [{ status: "skipped" }] },
          ],
        },
      ],
    },
  ],
};

describe("summarizeE2e", () => {
  it("sorts passed, flaky, failed and skipped tests and names the nested ones", () => {
    const s = summarizeE2e(report);
    expect(s.passed).toBe(1);
    expect(s.skipped).toBe(1);
    expect(s.flaky).toEqual(["journeys.spec.ts > at 360x640 > shop"]);
    expect(s.failed).toEqual(["journeys.spec.ts > at 360x640 > list"]);
  });

  it("reads an empty or odd report as nothing run", () => {
    expect(summarizeE2e({})).toEqual({ passed: 0, failed: [], flaky: [], skipped: 0 });
    expect(summarizeE2e(null).passed).toBe(0);
  });

  it("describes the run in one line, and says what is flaky", () => {
    expect(describeE2e(summarizeE2e(report))).toBe("1 passed, 1 flaky (failed, then passed on the retry), 1 failed, 1 skipped");
  });
});
