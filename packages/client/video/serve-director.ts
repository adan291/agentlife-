// Serves the director page of the video recorder on the loopback address, so the browser lets it frame the hotels
// (a page with no real address may not frame 127.0.0.1). Started by playwright.video.config.ts.
import http from "node:http";
import { DIRECTOR_HTML } from "./director.ts";

const port = Number(process.env["PORT"] ?? 5194);
http
  .createServer((req, res) => {
    if (req.url !== "/" && req.url !== "/director") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(DIRECTOR_HTML);
  })
  .listen(port, "127.0.0.1", () => console.log(`director on http://127.0.0.1:${port}/`));
