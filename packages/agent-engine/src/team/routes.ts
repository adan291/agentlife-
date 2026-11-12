import { CatalogueResponseSchema } from "@agentlife/shared";
import { sendJson, type Route } from "../http/server.ts";
import type { Catalogue } from "./catalogue.ts";

/** `GET /catalogue`: the templates that can be hired, with role, tier, default model, source and whether they are built in or imported. */
export function createCatalogueRoute(catalogue: Catalogue): Route {
  return {
    method: "GET",
    pattern: /^\/catalogue$/,
    handle: ({ res }) => sendJson(res, 200, CatalogueResponseSchema, catalogue.entries()),
  };
}
