// A small local server for dist/:  node scripts/serve.mjs [port]
// It behaves like the live host: folders answer at /name/, a missing page gets the 404 page, and the headers in dist/_headers are
// applied, so a broken Content-Security-Policy shows up here and not after a deploy. It also answers the feedback form's POST to
// /api/feedback with the same Worker code the live site runs, over a local SQLite file (.dev-feedback.sqlite, not committed;
// FEEDBACK_DB=:memory: keeps it in memory instead).

import { createServer } from "node:http";
import { join } from "node:path";
import { createStatic } from "./lib/static.mjs";
import { localDatabase } from "./lib/d1-sqlite.mjs";
import { handleFeedback } from "../worker/feedback.mjs";

const root = join(import.meta.dirname, "..");
const port = Number(process.argv[2] ?? process.env.PORT ?? 3020);
const serveFiles = createStatic(join(root, "dist"));
const env = { DB: localDatabase(process.env.FEEDBACK_DB ?? join(root, ".dev-feedback.sqlite")) };

createServer(async (req, res) => {
  if (req.url?.split("?")[0] === "/api/feedback") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const origin = `http://${req.headers.host}`;
    const request = new Request(origin + req.url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const response = await handleFeedback(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  serveFiles(req, res);
}).listen(port, () => console.log(`Frills is at http://localhost:${port}/`));
