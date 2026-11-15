import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { BUG_CHUNK_CHARS, BUG_SHOT_MAX_BYTES, ClientMsgSchema, MAX_MESSAGE_BYTES } from "@agentlife/shared";
import type { ClientMsg } from "@agentlife/shared";
import { UPLOAD_GAP_MS, base64Bytes, chunkBase64, newUploadId, pngBase64, sendUpload, shootUnderLimit, uploadMessages } from "../src/bugs/screenshot.ts";

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

describe("pngBase64", () => {
  it("takes the base64 out of a PNG data URL and nothing else", () => {
    expect(pngBase64("data:image/png;base64,iVBORw0KGgo=")).toBe("iVBORw0KGgo=");
    expect(pngBase64("data:image/jpeg;base64,AAAA")).toBeUndefined();
    expect(pngBase64("data:image/png;base64,")).toBeUndefined();
    expect(pngBase64("data:image/png;base64,AA AA")).toBeUndefined();
    expect(pngBase64("https://evil.test/x.png")).toBeUndefined();
    expect(pngBase64("")).toBeUndefined();
  });
});

describe("base64Bytes", () => {
  it("counts the bytes of any base64 text (property)", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 500 }), (bytes) => {
        expect(base64Bytes(b64(bytes))).toBe(bytes.length);
      }),
    );
  });
});

describe("chunkBase64", () => {
  it("cuts the text into pieces that join back to it, each of at most the size and, but the last, a multiple of 4 (property)", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 1, maxLength: 4000 }), fc.integer({ min: 1, max: 100 }), (bytes, units) => {
        const text = b64(bytes);
        const size = units * 4;
        const pieces = chunkBase64(text, size);
        expect(pieces.join("")).toBe(text);
        for (const [i, p] of pieces.entries()) {
          expect(p.length).toBeLessThanOrEqual(size);
          if (i < pieces.length - 1) expect(p.length % 4).toBe(0);
        }
        // Each piece decodes alone, and the decoded pieces make the bytes.
        expect(Buffer.concat(pieces.map((p) => Buffer.from(p, "base64")))).toEqual(Buffer.from(bytes));
      }),
    );
  });

  it("uses the size the server expects by default", () => {
    expect(chunkBase64("A".repeat(BUG_CHUNK_CHARS * 2 + 5)).map((p) => p.length)).toEqual([BUG_CHUNK_CHARS, BUG_CHUNK_CHARS, 5]);
    expect(BUG_CHUNK_CHARS % 4).toBe(0);
  });
});

describe("uploadMessages", () => {
  const text = b64(new Uint8Array(30_000).fill(9));

  it("numbers the pieces from 0 and marks the last, and each is a valid message that fits the server's limit", () => {
    const msgs = uploadMessages("abcdef123456", text);
    expect(msgs.map((m) => m.seq)).toEqual(msgs.map((_, i) => i));
    expect(msgs.map((m) => m.last)).toEqual(msgs.map((_, i) => i === msgs.length - 1));
    for (const m of msgs) {
      expect(ClientMsgSchema.safeParse(m).success).toBe(true);
      expect(JSON.stringify(m).length).toBeLessThan(MAX_MESSAGE_BYTES);
    }
    expect(msgs.map((m) => m.data).join("")).toBe(text);
  });

  it("a screenshot of the biggest size needs no more pieces than the protocol allows", () => {
    const biggest = b64(new Uint8Array(BUG_SHOT_MAX_BYTES));
    for (const m of uploadMessages("abcdef123456", biggest)) expect(ClientMsgSchema.safeParse(m).success).toBe(true);
  });
});

describe("newUploadId", () => {
  it("is 12 lower case letters and digits", () => {
    for (let i = 0; i < 50; i++) expect(newUploadId()).toMatch(/^[a-z0-9]{12}$/);
    expect(newUploadId(() => 0)).toBe("000000000000");
    expect(newUploadId(() => 0.999999)).toBe("zzzzzzzzzzzz");
  });
});

describe("shootUnderLimit", () => {
  const url = (bytes: number): string => `data:image/png;base64,${b64(new Uint8Array(bytes))}`;

  it("takes the picture at full size when it fits", async () => {
    const scales: number[] = [];
    const out = await shootUnderLimit(async (s) => (scales.push(s), url(1000)));
    expect(out).toBe(b64(new Uint8Array(1000)));
    expect(scales).toEqual([1]);
  });

  it("tries again at half and then a quarter of the size when the PNG is over 1 MiB", async () => {
    const scales: number[] = [];
    const out = await shootUnderLimit(async (s) => (scales.push(s), url(s === 1 ? BUG_SHOT_MAX_BYTES + 3 : s === 0.5 ? BUG_SHOT_MAX_BYTES + 1 : 500)));
    expect(scales).toEqual([1, 0.5, 0.25]);
    expect(out).toBe(b64(new Uint8Array(500)));
  });

  it("gives up when even a quarter is too big, when the answer is not a PNG, and when taking it throws", async () => {
    expect(await shootUnderLimit(async () => url(BUG_SHOT_MAX_BYTES + 1))).toBeUndefined();
    expect(await shootUnderLimit(async () => "not a data url")).toBeUndefined();
    expect(
      await shootUnderLimit(async () => {
        throw new Error("no canvas");
      }),
    ).toBeUndefined();
  });

  it("accepts a picture of exactly 1 MiB", async () => {
    expect(await shootUnderLimit(async () => url(BUG_SHOT_MAX_BYTES))).toBeDefined();
  });
});

describe("sendUpload", () => {
  it("sends the pieces in order with the gap between them, and none after the last", async () => {
    const out: ClientMsg[] = [];
    const waits: number[] = [];
    const msgs = uploadMessages("abcdef123456", "A".repeat(BUG_CHUNK_CHARS * 3));
    await sendUpload((m) => void out.push(m), msgs, UPLOAD_GAP_MS, async (ms) => void waits.push(ms));
    expect(out).toEqual(msgs);
    expect(waits).toEqual([UPLOAD_GAP_MS, UPLOAD_GAP_MS]);
  });

  it("is slower than the server's limit of 20 messages a second", () => {
    expect(1000 / UPLOAD_GAP_MS).toBeLessThan(20);
  });
});
