import { describe, expect, it } from "vitest";
import { decideMode, parseArgs, parseEnvFile, providerOfKey } from "../hotel-lib.ts";

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
  it("reads --ai and --model in both forms and refuses malformed values", () => {
    expect(parseArgs(["--ai", "ollama", "--model=qwen3.5:4b"]).options).toMatchObject({ ai: "ollama", model: "qwen3.5:4b" });
    expect(parseArgs(["--ai=openrouter", "--model", "meta-llama/llama-3.1-8b-instruct"]).options).toMatchObject({ ai: "openrouter", model: "meta-llama/llama-3.1-8b-instruct" });
    expect(parseArgs(["--ai", "Bad Id"]).unknown).toEqual(["--ai Bad Id"]);
    expect(parseArgs(["--model", "a;rm"]).unknown).toEqual(["--model a;rm"]);
  });
});

describe("parseEnvFile provider keys", () => {
  it("keeps the keys of the other AIs", () => {
    const v = ["k", "1"].join("-");
    expect(parseEnvFile(`XAI_API_KEY=${v}\nGROQ_API_KEY=${v}\nOPENAI_API_KEY=${v}\nOPENROUTER_API_KEY=${v}`)).toEqual({ XAI_API_KEY: v, GROQ_API_KEY: v, OPENAI_API_KEY: v, OPENROUTER_API_KEY: v });
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
  it("without a Kiro key falls back to Ollama when it runs here", () => {
    const m = decideMode({ ...base, hasKiroKey: false, ollamaUp: true });
    expect(m).toMatchObject({ runtime: "real", ai: "ollama" });
    expect(decideMode({ ...base, ollamaUp: true }).ai).toBeUndefined();
  });
  it("without a Kiro key or Ollama uses a cloud AI whose key is set", () => {
    expect(decideMode({ ...base, hasKiroKey: false, cloudReady: [providerOfKey("XAI_API_KEY")] })).toMatchObject({ runtime: "real", ai: "xai" });
    expect(decideMode({ ...base, hasKiroKey: false, ollamaUp: true, cloudReady: ["groq"] }).ai).toBe("ollama");
    expect(decideMode({ ...base, hasKiroKey: false, cloudReady: [] }).runtime).toBe("fake");
  });
  it("--ai needs no Kiro key; --ai kiro still does", () => {
    expect(decideMode({ ...base, hasKiroKey: false, options: { fake: false, real: false, ai: "xai" } })).toMatchObject({ runtime: "real", ai: "xai" });
    expect(decideMode({ ...base, hasKiroKey: false, options: { fake: false, real: false, ai: "kiro" } }).runtime).toBe("fake");
  });
});
