// The AI providers of the hotel (multi-runtime): which exist (config/providers.json), which can work now, and the runtime of
// each. Keys are read from the environment by name; they never leave the engine.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KIRO_PROVIDER, ProvidersFileSchema, type ProviderConfig, type ProviderView } from "@agentlife/shared";
import { isLoopbackUrl } from "../runtimes/ollama.ts";
import { OpenAICompatRuntime } from "../runtimes/openai-compat.ts";
import type { AgentRuntime } from "../runtimes/types.ts";

export const PROVIDERS_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "config", "providers.json");
const CHECK_TTL_MS = 10_000;
const PROBE_TIMEOUT_MS = 1_500;

export function loadProviders(file: string = PROVIDERS_FILE): ProviderConfig[] {
  return ProvidersFileSchema.parse(JSON.parse(readFileSync(file, "utf8"))).providers;
}

export interface ProviderRegistryOptions {
  providers?: readonly ProviderConfig[];
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  /** Whether kiro-cli can run jobs here. Default: kiro-cli answers `--version` and KIRO_API_KEY is set. */
  kiroAvailable?: () => boolean;
}

function defaultKiroAvailable(env: NodeJS.ProcessEnv): () => boolean {
  let cached: boolean | undefined;
  return () => {
    if (cached === undefined) {
      const r = spawnSync("kiro-cli", ["--version"], { stdio: "ignore", windowsHide: true, timeout: 10_000 });
      cached = r.status === 0;
    }
    return cached && Boolean(env["KIRO_API_KEY"]);
  };
}

export class ProviderRegistry {
  private readonly list: readonly ProviderConfig[];
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetchFn: typeof fetch;
  private readonly kiroAvailable: () => boolean;
  private readonly runtimes = new Map<string, OpenAICompatRuntime>();
  private cache: { at: number; views: ProviderView[] } | undefined;

  constructor(opts: ProviderRegistryOptions = {}) {
    this.list = opts.providers ?? loadProviders();
    this.env = opts.env ?? process.env;
    this.fetchFn = opts.fetch ?? fetch;
    this.kiroAvailable = opts.kiroAvailable ?? defaultKiroAvailable(this.env);
  }

  all(): readonly ProviderConfig[] {
    return this.list;
  }

  get(id: string): ProviderConfig | undefined {
    return this.list.find((p) => p.id === id);
  }

  label(id: string): string | undefined {
    return this.get(id)?.label;
  }

  private key(p: ProviderConfig): string | undefined {
    const v = p.apiKeyEnv ? this.env[p.apiKeyEnv] : undefined;
    return v && v.trim() !== "" ? v.trim() : undefined;
  }

  /**
   * The runtime of an `openai-compat` provider, made once. Undefined for kiro (the caller has the kiro-cli runtime) and for
   * a provider that cannot be used: a local one whose address is not on this computer, a cloud one without its key.
   */
  runtime(id: string): AgentRuntime | undefined {
    const p = this.get(id);
    if (!p || p.kind !== "openai-compat" || !p.baseUrl) return undefined;
    if (p.local && !isLoopbackUrl(p.baseUrl)) return undefined;
    const key = this.key(p);
    if (!p.local && p.apiKeyEnv && !key) return undefined;
    let rt = this.runtimes.get(id);
    if (!rt) {
      rt = new OpenAICompatRuntime({
        providerId: p.id,
        label: p.label,
        baseUrl: p.baseUrl,
        ...(key ? { apiKey: key } : {}),
        ...(p.models[0] ? { defaultModel: p.models[0] } : {}),
        fetch: this.fetchFn,
      });
      this.runtimes.set(id, rt);
    }
    return rt;
  }

  /** What `GET /providers` answers: availability with a reason, and the models. No address, no key. */
  async views(force = false): Promise<ProviderView[]> {
    if (!force && this.cache && Date.now() - this.cache.at < CHECK_TTL_MS) return this.cache.views;
    const views = await Promise.all(this.list.map((p) => this.view(p)));
    this.cache = { at: Date.now(), views };
    return views;
  }

  private async view(p: ProviderConfig): Promise<ProviderView> {
    const base = { id: p.id, label: p.label, kind: p.kind, local: p.local, cloud: p.kind === "openai-compat" && !p.local };
    if (p.kind === "kiro-cli") {
      const ok = p.id === KIRO_PROVIDER && this.kiroAvailable();
      return { ...base, available: ok, models: [...p.models], ...(ok ? {} : { reason: "kiro-cli or KIRO_API_KEY is missing." }) };
    }
    if (p.local) {
      if (!p.baseUrl || !isLoopbackUrl(p.baseUrl)) return { ...base, available: false, reason: "Its address is not on this computer, so it is not used.", models: [] };
      const models = await this.localModels(p.baseUrl);
      if (models === undefined) return { ...base, available: false, reason: `${p.label} is not running on this computer.`, models: [...p.models] };
      return { ...base, available: models.length > 0, models, ...(models.length ? {} : { reason: `${p.label} has no model installed.` }) };
    }
    const key = this.key(p);
    if (p.apiKeyEnv && !key) return { ...base, available: false, reason: `Set ${p.apiKeyEnv} in .env to use ${p.label}.`, models: [...p.models] };
    return { ...base, available: true, models: [...p.models] };
  }

  /** The models a local server has (`GET /models`), or undefined when it does not answer. */
  private async localModels(baseUrl: string): Promise<string[] | undefined> {
    try {
      const res = await this.fetchFn(`${baseUrl.replace(/\/+$/, "")}/models`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { data?: { id?: unknown }[] };
      return (body.data ?? [])
        .map((m) => m.id)
        .filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$/.test(id))
        .slice(0, 100);
    } catch {
      return undefined;
    }
  }
}
