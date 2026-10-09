// A small local server for dist/:  node scripts/serve.mjs [port]
// It behaves like the live host: folders answer at /name/, a missing page gets the 404 page, and the headers in dist/_headers are
// applied, so a broken Content-Security-Policy shows up here and not after a deploy.

import { createServer } from "node:http";
import { join } from "node:path";
import { createStatic } from "./lib/static.mjs";

const root = join(import.meta.dirname, "..", "dist");
const port = Number(process.argv[2] ?? process.env.PORT ?? 3020);

createServer(createStatic(root)).listen(port, () => console.log(`Frills is at http://localhost:${port}/`));
