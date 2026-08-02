import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(process.cwd());
const port = Number(process.env.PORT || 4173);

const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"]
]);

function safePath(pathname) {
  const decoded = decodeURIComponent(pathname.split("?")[0]);
  const requested = decoded === "/" ? "/index.html" : decoded;
  const filePath = normalize(join(root, requested));
  return filePath.startsWith(root) ? filePath : join(root, "index.html");
}

const server = createServer(async (request, response) => {
  try {
    const filePath = safePath(new URL(request.url, `http://localhost:${port}`).pathname);
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": types.get(extname(filePath)) || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(body);
  } catch {
    try {
      const body = await readFile(join(root, "index.html"));
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  }
});

server.listen(port, () => {
  console.log(`Ericensen homepage running at http://localhost:${port}/`);
});
