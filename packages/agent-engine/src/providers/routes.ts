import { ProvidersResponseSchema } from "@agentlife/shared";
import { sendJson, type Route } from "../http/server.ts";
import type { ProviderRegistry } from "./registry.ts";

/** `GET /providers`: every provider with its availability and models. No address, no key. */
export function createProviderRoutes(registry: ProviderRegistry): Route[] {
  return [
    {
      method: "GET",
      pattern: /^\/providers$/,
      handle: async ({ res }) => sendJson(res, 200, ProvidersResponseSchema, { providers: await registry.views() }),
    },
  ];
}
