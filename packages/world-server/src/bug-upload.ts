import { BUG_CHUNKS_MAX, BUG_CHUNK_CHARS, BUG_SHOT_BASE64_MAX, BUG_SHOT_MAX_BYTES, BUG_UPLOAD_TTL_MS } from "@agentlife/shared";

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export interface UploadChunk {
  id: string;
  seq: number;
  last: boolean;
  data: string;
}

/**
 * Puts the pieces of one screenshot back together (spec bug-sack, task 2). A message may be 16 KB, a screenshot up to 1 MiB,
 * so the browser sends base64 pieces in order and then a `bug_report` that names the upload. One of these exists per
 * connection and holds one upload at a time: a piece number 0 starts again, anything out of order drops the upload. It
 * never keeps more than the biggest screenshot, and a finished upload that nobody claims is forgotten after a minute.
 * It does not look inside the bytes: the store checks the PNG signature and the size when the report is kept.
 */
export class ShotUpload {
  private readonly now: () => number;
  private id: string | undefined;
  private pieces: string[] = [];
  private next = 0;
  private chars = 0;
  private finished: { id: string; bytes: Uint8Array; at: number } | undefined;

  // No parameter properties: node's type stripping does not support them.
  constructor(now: () => number) {
    this.now = now;
  }

  /** Takes one piece. Returns the reason it was refused (the upload is dropped), or undefined. */
  push(c: UploadChunk): string | undefined {
    if (c.seq === 0) this.drop();
    else if (this.id !== c.id || this.next !== c.seq) {
      this.drop();
      return "The screenshot arrived out of order and was dropped.";
    }
    if (c.seq > BUG_CHUNKS_MAX || c.data.length > BUG_CHUNK_CHARS || !BASE64.test(c.data) || (!c.last && c.data.length % 4 !== 0)) {
      this.drop();
      return "The screenshot was not valid and was dropped.";
    }
    this.chars += c.data.length;
    if (this.chars > BUG_SHOT_BASE64_MAX) {
      this.drop();
      return "The screenshot is too big and was dropped.";
    }
    this.id = c.id;
    this.pieces.push(c.data);
    this.next = c.seq + 1;
    if (!c.last) return undefined;
    const bytes = Buffer.from(this.pieces.join(""), "base64");
    const id = c.id;
    this.drop();
    if (bytes.length > BUG_SHOT_MAX_BYTES) return "The screenshot is too big and was dropped.";
    this.finished = { id, bytes, at: this.now() };
    return undefined;
  }

  /** The finished upload with this id, once. Undefined when there is none, it is another one, or it waited too long. */
  take(id: string): Uint8Array | undefined {
    const f = this.finished;
    if (!f || f.id !== id) return undefined;
    this.finished = undefined;
    return this.now() - f.at <= BUG_UPLOAD_TTL_MS ? f.bytes : undefined;
  }

  private drop(): void {
    this.id = undefined;
    this.pieces = [];
    this.next = 0;
    this.chars = 0;
    this.finished = undefined;
  }
}
