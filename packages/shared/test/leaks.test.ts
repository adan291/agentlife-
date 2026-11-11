import { describe, expect, it } from "vitest";
import {
  createLeakScanner,
  envSecretValues,
  groupFindings,
  isBlockingLeak,
  leakHash,
  maskLeak,
} from "../src/leaks.ts";

// Fake secrets are built at runtime so that no key-shaped literal sits in the repository.
const fakeKiroKey = () => ["ksk", "_", "a1B2c3D4e5F6g7H8i9J0"].join("");
const fakeGithubToken = () => ["ghp", "_", "x".repeat(36)].join("");
// The same goes for addresses and home paths: the repository scanner would flag the literals.
const email = (user: string, host: string) => [user, host].join("@");
const homePath = (user: string) => ["C:", "Users", user].join("\\");

describe("leak scanner", () => {
  it("finds keys, emails and tracked env files, and masks every value", () => {
    const s = createLeakScanner();
    s.scanText(`const k = "${fakeKiroKey()}"; mail me at ${email("jane.doe", "corp.io")}`, "src/a.ts");
    s.scanFile(".env", new TextEncoder().encode("A=1"));
    const kinds = s.findings.map((f) => `${f.severity}:${f.kind}`).sort();
    expect(kinds).toEqual(["high:kiro-api-key", "high:tracked-env-file", "medium:email"]);
    const dump = JSON.stringify(s.findings);
    expect(dump).not.toContain(fakeKiroKey());
    expect(dump).not.toContain("jane.doe");
  });

  it("does not report safe addresses, example paths, .env.example, lockfiles or binary content", () => {
    const s = createLeakScanner();
    s.scanText(`${email("a", "users.noreply.github.com")} ${email("b", "example.com")} ${email("c", "agentlife.local")} ${homePath("you")}`, "x");
    s.scanFile(".env.example", new TextEncoder().encode("KEY="));
    s.scanFile("package-lock.json", new TextEncoder().encode(`"integrity": "${fakeKiroKey()}"`));
    s.scanFile("logo.bin", Uint8Array.from([0, 1, 2, ...new TextEncoder().encode(fakeKiroKey())]));
    expect(s.findings).toEqual([]);
  });

  it("finds a known secret value exactly and ignores short values", () => {
    const secret = "correct-horse-battery-staple";
    const s = createLeakScanner({ secrets: [secret, "short"] });
    s.scanText(`token=${secret} short`, "notes.txt");
    expect(s.findings.map((f) => f.kind)).toEqual(["known-secret-value"]);
    expect(JSON.stringify(s.findings)).not.toContain(secret);
  });

  it("skips accepted ids and reports one finding per value and place", () => {
    const token = fakeGithubToken();
    const first = createLeakScanner();
    first.scanText(token, "a.txt");
    first.scanText(token, "a.txt");
    first.scanText(token, "b.txt");
    expect(first.findings).toHaveLength(2);
    expect(groupFindings(first.findings)).toHaveLength(1);
    expect(groupFindings(first.findings)[0]!.where).toEqual(["a.txt", "b.txt"]);

    const accepted = createLeakScanner({ allow: new Set([first.findings[0]!.id]) });
    accepted.scanText(token, "a.txt");
    expect(accepted.findings).toEqual([]);
  });

  it("identifies a value by hash of kind and value, and masks values to their length only (no characters revealed)", () => {
    expect(leakHash("x")).toMatch(/^[0-9a-f]{12}$/);
    expect(maskLeak("abc")).toBe("*** (3 chars)");
    expect(maskLeak(email("someone", "host.com"))).toBe("s***@host.com");
    expect(maskLeak("0123456789abcdef")).toBe("*** (16 chars)");
    expect(maskLeak("0123456789abcdef")).not.toMatch(/0123|ef/);
  });

  it("orders groups by severity and treats only low as non-blocking", () => {
    const s = createLeakScanner();
    s.scanText(homePath("bob"), "p");
    s.scanText(email("bob", "corp.io"), "q");
    s.scanText(fakeKiroKey(), "r");
    expect(groupFindings(s.findings).map((g) => g.finding.severity)).toEqual(["high", "medium", "low"]);
    expect(s.findings.map(isBlockingLeak).sort()).toEqual([false, true, true]);
  });

  it("reads only the well-known secret variables, at least 12 characters", () => {
    expect(envSecretValues({ KIRO_API_KEY: "a".repeat(20), GITHUB_TOKEN: "short", OTHER: "b".repeat(30) })).toEqual(["a".repeat(20)]);
  });
});
