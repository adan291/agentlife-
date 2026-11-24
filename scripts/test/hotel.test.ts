import { describe, expect, it } from "vitest";
import { decideMode, parseArgs, parseEnvFile } from "../hotel-lib.ts";

describe("parseEnvFile", () => {
  it("keeps only the known keys, drops comments, blanks and quotes", () => {
    const key = ["fake", "value", "123"].join("-");
    const text = [`# comment`, ``, `KIRO_API_KEY="${key}"`, `LLM_MODEL='qwen3.5:4b'`, `export LLM_BASE_URL=http://127.0.0.1:11434/v1`, `OTHER=secret`, `BROKEN`, `ENGINE_TOKEN=`].join("\r\n");
    expect(parseEnvFile(text)).toEqual({ KIRO_API_KEY: key, LLM_MODEL: "qwen3.5:4b", LLM_BASE_URL: "http://127.0.0.1:11434/v1" });
  });
});

describe("parseArgs", () => {
  it("reads the flags and returns the unknown ones", () => {
    const { options, unknown } = parseArgs(["--fake", "--no-open", "--restart", "--", "--nope"]);
    expect(options).toEqual({ fake: true, real: false, open: false, restart: true, help: false });
    expect(unknown).toEqual(["--nope"]);
  });
});

describe("decideMode", () => {
  const base = { options: { fake: false, real: false }, hasKiroKey: true, dockerUp: true };
  it("uses real agents when the key and Docker are there", () => {
    expect(decideMode(base).runtime).toBe("real");
  });
  it("falls back to scripted agents and says why", () => {
    const m = decideMode({ ...base, hasKiroKey: false, dockerUp: false });
    expect(m.runtime).toBe("fake");
    expect(m.notes.join("\n")).toContain("KIRO_API_KEY");
    expect(m.notes.join("\n")).toContain("Docker");
  });
  it("--fake always wins, --real forces real agents", () => {
    expect(decideMode({ ...base, options: { fake: true, real: true } }).runtime).toBe("fake");
    expect(decideMode({ ...base, dockerUp: false, options: { fake: false, real: true } }).runtime).toBe("real");
  });
});
