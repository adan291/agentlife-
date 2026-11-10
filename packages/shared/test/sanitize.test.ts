import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MAX_TEXT, sanitize } from "../src/index.ts";

const FORBIDDEN = /[A-Za-z]:[\\/]|ksk_/;

describe("sanitize", () => {
  it("removes paths and key-like tokens", () => {
    expect(sanitize("see C:\\Users\\me\\secret.txt now")).toBe("see now");
    expect(sanitize("open /etc/passwd please")).toBe("open please");
    expect(sanitize("key ksk_abc123 end")).toBe("key end");
    expect(sanitize("TOKEN=abc run $env:KIRO_API_KEY end")).toBe("run end");
  });

  it("caps the length at 80 by default", () => {
    expect(MAX_TEXT).toBe(80);
    expect(sanitize("a ".repeat(100)).length).toBeLessThanOrEqual(80);
  });

  it("never exceeds 80 chars and never leaks drive paths, ksk_ or NAME=value (property)", () => {
    const alphabet = fc.constantFrom("a", "k", "s", "_", "C", ":", "\\", "/", " ", "x", "1", ".", "=", "$", "e", "n", "v");
    fc.assert(
      fc.property(fc.array(alphabet, { maxLength: 200 }).map((a) => a.join("")), (s) => {
        const out = sanitize(s);
        return out.length <= 80 && !FORBIDDEN.test(out) && !/\b[A-Za-z_]\w*=/.test(out) && !/\$env:/i.test(out);
      }),
      { numRuns: 500 },
    );
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (s) => {
        const out = sanitize(s);
        return out.length <= 80 && !FORBIDDEN.test(out);
      }),
    );
  });
});
