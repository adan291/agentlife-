import { BUG_CHUNK_CHARS, BUG_SHOT_MAX_BYTES } from "@agentlife/shared";
import type { ClientMsg } from "@agentlife/shared";

/** Milliseconds between two pieces of a screenshot: the server accepts 20 messages a second, the pieces use about 12. */
export const UPLOAD_GAP_MS = 80;

const DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;

/** The base64 of a PNG data URL, or undefined for anything else. */
export function pngBase64(dataUrl: string): string | undefined {
  return DATA_URL.exec(dataUrl)?.[1];
}

/** How many bytes a base64 text holds. */
export function base64Bytes(b64: string): number {
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/** The text cut into pieces of `size` characters (a multiple of 4, so each piece decodes alone). */
export function chunkBase64(b64: string, size: number = BUG_CHUNK_CHARS): string[] {
  const out: string[] = [];
  for (let i = 0; i < b64.length; i += size) out.push(b64.slice(i, i + size));
  return out;
}

/** The messages that upload a screenshot, in order: `bug_upload` pieces numbered from 0, the last one marked. */
export function uploadMessages(id: string, b64: string): Extract<ClientMsg, { type: "bug_upload" }>[] {
  const pieces = chunkBase64(b64);
  return pieces.map((data, seq) => ({ type: "bug_upload", id, seq, last: seq === pieces.length - 1, data }));
}

/** A fresh id for an upload: lower case letters and digits, 12 characters. */
export function newUploadId(random: () => number = Math.random): string {
  let id = "";
  for (let i = 0; i < 12; i++) id += Math.floor(random() * 36).toString(36);
  return id;
}

/**
 * Takes a screenshot at full size and, when the PNG is over the limit, again at half the size and then a quarter.
 * `take(scale)` returns a PNG data URL; undefined (or a bad answer) means no screenshot.
 */
export async function shootUnderLimit(take: (scale: number) => Promise<string>): Promise<string | undefined> {
  for (const scale of [1, 0.5, 0.25]) {
    let b64: string | undefined;
    try {
      b64 = pngBase64(await take(scale));
    } catch {
      return undefined;
    }
    if (b64 && base64Bytes(b64) <= BUG_SHOT_MAX_BYTES) return b64;
  }
  return undefined;
}

/** Sends the pieces one after the other, `gap` milliseconds apart. Resolves when the last one is out. */
export function sendUpload(
  send: (msg: ClientMsg) => void,
  messages: readonly ClientMsg[],
  gap: number = UPLOAD_GAP_MS,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  return (async () => {
    for (let i = 0; i < messages.length; i++) {
      send(messages[i]!);
      if (i < messages.length - 1) await wait(gap);
    }
  })();
}
