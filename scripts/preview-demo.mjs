import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const base = process.env.DEMO_BASE_PATH || '/foodheaven/';
const port = Number(process.env.DEMO_PORT || 3200);
const types = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg' };
http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!pathname.startsWith(base) || !['GET','HEAD'].includes(request.method)) { response.writeHead(404); response.end(); return; }
    let relative = pathname.slice(base.length) || 'index.html';
    if (relative.split('/').some(part => part.startsWith('.'))) throw new Error('Not found');
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(root + path.sep)) throw new Error('Not found');
    const file = (await stat(filename)).isDirectory() ? path.join(filename, 'index.html') : filename;
    response.writeHead(200, { 'Content-Type':(types[path.extname(file)] || 'application/octet-stream')+'; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
    response.end(request.method==='HEAD' ? null : await readFile(file));
  } catch { response.writeHead(404); response.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log('FoodHeaven demo: http://127.0.0.1:'+port+base));
