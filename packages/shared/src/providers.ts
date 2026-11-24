import { z } from "zod";

/**
 * AI providers (multi-runtime). A provider is `kiro-cli` or any API that speaks the OpenAI chat-completions format with
 * tool calling (Ollama, LM Studio, Groq, xAI Grok, OpenAI, OpenRouter...). Each role and each team member picks one.
 */
export const ProviderIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,29}$/, "lowercase letters, digits and dashes");
export type ProviderId = z.infer<typeof ProviderIdSchema>;

/** The built-in provider: kiro-cli with its own agent files and permissions. */
export const KIRO_PROVIDER = "kiro";

export const ProviderKindSchema = z.enum(["kiro-cli", "openai-compat"]);
export type ProviderKind = z.infer<typeof ProviderKindSchema>;

/** Model names: Ollama tags (`qwen3.5:4b`), OpenRouter paths (`meta-llama/llama-3.1-8b`), plain ids. */
export const ProviderModelSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$/, "not a model name");

export const ProviderConfigSchema = z
  .object({
    id: ProviderIdSchema,
    label: z.string().min(1).max(40),
    kind: ProviderKindSchema,
    /** `openai-compat`: the address that ends before `/chat/completions`, for example `https://api.x.ai/v1`. */
    baseUrl: z.string().url().optional(),
    /** Name of the environment variable that holds the key (never the key itself). */
    apiKeyEnv: z.string().regex(/^[A-Z][A-Z0-9_]{1,60}$/).optional(),
    /** The address must be on this computer (Ollama, LM Studio): prompts never leave the machine. */
    local: z.boolean().default(false),
    /** Suggested models; a local provider also lists what its server has. */
    models: z.array(ProviderModelSchema).max(30).default([]),
  })
  .superRefine((p, ctx) => {
    if (p.kind === "openai-compat" && !p.baseUrl) ctx.addIssue({ code: "custom", message: "an openai-compat provider needs a baseUrl" });
    if (p.kind === "openai-compat" && p.baseUrl && !p.local && !p.baseUrl.startsWith("https://")) {
      ctx.addIssue({ code: "custom", message: "a cloud provider must use https" });
    }
  });
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const ProvidersFileSchema = z
  .object({ version: z.literal(1), providers: z.array(ProviderConfigSchema).min(1).max(20) })
  .superRefine((f, ctx) => {
    const ids = new Set<string>();
    for (const p of f.providers) {
      if (ids.has(p.id)) ctx.addIssue({ code: "custom", message: `provider id '${p.id}' is used twice` });
      ids.add(p.id);
    }
    if (!ids.has(KIRO_PROVIDER)) ctx.addIssue({ code: "custom", message: `the '${KIRO_PROVIDER}' provider must be listed` });
  });
export type ProvidersFile = z.infer<typeof ProvidersFileSchema>;

/** What the client sees of a provider: never an address or a key. */
export const ProviderViewSchema = z.object({
  id: ProviderIdSchema,
  label: z.string(),
  kind: ProviderKindSchema,
  local: z.boolean(),
  /** A cloud provider receives the files its agent reads. */
  cloud: z.boolean(),
  available: z.boolean(),
  /** Why it is not available, in a sentence the user can act on. */
  reason: z.string().max(200).optional(),
  models: z.array(ProviderModelSchema).max(100),
});
export type ProviderView = z.infer<typeof ProviderViewSchema>;

export const ProvidersResponseSchema = z.object({ providers: z.array(ProviderViewSchema).max(20) });
export type ProvidersResponse = z.infer<typeof ProvidersResponseSchema>;

/** "qwen3.5:4b (Ollama)": the model label of a step run on a provider other than Kiro. */
export function providerModelLabel(model: string, providerLabel: string | undefined): string {
  return providerLabel ? `${model} (${providerLabel})` : model;
}
