// The director page of the video recorder: a full-window iframe for the hotel, a title card, captions, and a recorder
// that captures the tab (getDisplayMedia, current tab) with the narration mixed in through WebAudio. Nothing here is part
// of the product; it only runs under `pnpm --filter @agentlife/client video`.
import type { Page } from "@playwright/test";

export const DIRECTOR_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>AGENT LIFE video</title>
<style>
  html, body { margin: 0; height: 100%; background: #0d0818; overflow: hidden; }
  #f { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; background: #0d0818; }
  #card { position: fixed; inset: 0; display: none; flex-direction: column; justify-content: center; padding: 0 96px; box-sizing: border-box;
          background: radial-gradient(circle at 30% 20%, #2a1748 0%, #0d0818 70%); color: #e8e0ff; font: 28px/1.45 "Segoe UI", system-ui, sans-serif; }
  #card h1 { font: 700 64px/1.1 "Segoe UI", system-ui, sans-serif; margin: 0 0 24px; letter-spacing: 2px; color: #f3ecff; }
  #card h2 { font: 600 34px/1.25 "Segoe UI", system-ui, sans-serif; margin: 0 0 18px; color: #c9b8ff; }
  #card p { margin: 0 0 14px; }
  #card .accent { color: #ff9e3d; }
  #card pre { margin: 0; padding: 18px 22px; background: #160d28; border: 1px solid #3b2a5e; border-radius: 10px; color: #dcd2ff;
              font: 17px/1.45 Consolas, "Cascadia Mono", monospace; white-space: pre; overflow: hidden; }
  #card .file { font: 16px Consolas, monospace; color: #9d8cc9; margin: 14px 0 6px; }
  #cap { position: fixed; left: 0; right: 0; bottom: 18px; display: none; justify-content: center; pointer-events: none; }
  #cap span { max-width: 1040px; padding: 8px 16px; border-radius: 8px; background: rgba(10, 6, 20, 0.86); color: #fff;
              font: 600 22px/1.35 "Segoe UI", system-ui, sans-serif; text-align: center; }
</style></head><body>
<iframe id="f" allow="autoplay"></iframe>
<div id="card"></div>
<div id="cap"><span></span></div>
<script>
  const ac = new AudioContext();
  const dest = ac.createMediaStreamDestination();
  let recorder, writing = Promise.resolve();
  window.dir = {
    async start() {
      const shot = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false, preferCurrentTab: true });
      const stream = new MediaStream([...shot.getVideoTracks(), ...dest.stream.getAudioTracks()]);
      recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9,opus", videoBitsPerSecond: 5000000, audioBitsPerSecond: 128000 });
      recorder.ondataavailable = (e) => {
        writing = writing.then(async () => {
          const buf = new Uint8Array(await e.data.arrayBuffer());
          let s = "";
          for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          await window.saveChunk(btoa(s));
        });
      };
      recorder.start(1000);
    },
    async stop() {
      const stopped = new Promise((r) => (recorder.onstop = r));
      recorder.stop();
      await stopped;
      await writing;
    },
    /** Plays a WAV (base64) into the recording only; resolves with its length in ms once it has started. */
    async say(b64) {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const audio = await ac.decodeAudioData(bytes.buffer);
      const src = ac.createBufferSource();
      src.buffer = audio;
      src.connect(dest);
      src.start();
      return Math.round(audio.duration * 1000);
    },
    caption(text) {
      const cap = document.getElementById("cap");
      cap.querySelector("span").textContent = text || "";
      cap.style.display = text ? "flex" : "none";
    },
    card(html) {
      const card = document.getElementById("card");
      card.innerHTML = html || "";
      card.style.display = html ? "flex" : "none";
    },
    frame(url) {
      document.getElementById("f").src = url;
    },
  };
</script></body></html>`;

/** Escapes text for the title cards. */
export const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Control of the director page from the test. */
export interface Director {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Plays a narration line, shows it as a caption, and resolves when it has finished. Records its time for the subtitles. */
  say(id: string, text: string, wav: Buffer | undefined, minMs?: number): Promise<void>;
  card(html: string | null): Promise<void>;
  frame(url: string): Promise<void>;
  wait(ms: number): Promise<void>;
  /** Subtitles of what was said, as SRT. */
  srt(): string;
}

export function director(page: Page): Director {
  let t0 = 0;
  const cues: { from: number; to: number; text: string }[] = [];
  const srtTime = (ms: number): string => {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
    return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
  };
  return {
    async start() {
      await page.evaluate(() => (window as unknown as { dir: { start(): Promise<void> } }).dir.start());
      t0 = Date.now();
    },
    async stop() {
      await page.evaluate(() => (window as unknown as { dir: { stop(): Promise<void> } }).dir.stop());
    },
    async say(_id, text, wav, minMs = 0) {
      const from = Date.now() - t0;
      await page.evaluate((t) => (window as unknown as { dir: { caption(t: string): void } }).dir.caption(t), text);
      // Without a voice (not Windows) the caption stays for a reading time of about 15 characters a second.
      const ms = wav
        ? await page.evaluate((b64) => (window as unknown as { dir: { say(b: string): Promise<number> } }).dir.say(b64), wav.toString("base64"))
        : Math.max(2500, text.length * 66);
      await page.waitForTimeout(Math.max(ms, minMs) + 350);
      cues.push({ from, to: Date.now() - t0, text });
      await page.evaluate(() => (window as unknown as { dir: { caption(t: string): void } }).dir.caption(""));
    },
    async card(html) {
      await page.evaluate((h) => (window as unknown as { dir: { card(h: string | null): void } }).dir.card(h), html);
    },
    async frame(url) {
      await page.evaluate((u) => (window as unknown as { dir: { frame(u: string): void } }).dir.frame(u), url);
    },
    wait: (ms) => page.waitForTimeout(ms),
    srt: () => cues.map((c, i) => `${i + 1}\n${srtTime(c.from)} --> ${srtTime(c.to)}\n${c.text}\n`).join("\n"),
  };
}
