// Build only the browser preview. The Flask app never loads the demo adapter.
import { mkdir, readFile, writeFile, readdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.DEMO_BASE_PATH || '/foodheaven/';
if (!/^\/(?:[a-z0-9-]+\/)*$/.test(base)) throw new Error('DEMO_BASE_PATH must be a safe absolute directory path.');
const output = path.join(root, 'dist');
const source = path.join(root, 'frontend');
const excluded = new Set(['node_modules', '.git', 'tests', 'package.json', 'package-lock.json', 'README.md']);
const staticLiteral = /(["'\x60])\/(?!\/)(?=[^"'\x60\s]{1,140}\.(?:html|css|js|svg|png|jpe?g|webp|ico)(?:[?#][^"'\x60\s]*)?["'\x60])/g;
let count = 0;
async function build(directory, relative = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || excluded.has(entry.name)) continue;
    const file = path.join(directory, entry.name), targetRelative = path.join(relative, entry.name);
    const target = path.join(output, targetRelative);
    if (entry.isDirectory()) { await build(file, targetRelative); continue; }
    if (!/\.(?:html|css|js|svg|png|jpe?g|webp|ico|woff2?)$/i.test(entry.name)) continue;
    await mkdir(path.dirname(target), { recursive: true });
    if (/\.(?:html|css|js|svg)$/i.test(entry.name)) {
      let content = await readFile(file, 'utf8');
      content = content.replace(staticLiteral, '$1' + base);
      if (targetRelative === 'app.js') {
        content = content.replace(/const publicPage = [^\r\n]+;/,
          'const publicPage = location.pathname === ' + JSON.stringify(base) +
          ' || location.pathname === ' + JSON.stringify(base + 'index.html') +
          ' || location.pathname.startsWith(' + JSON.stringify(base + 'Portal_login/') + ');');
      }
      if (entry.name.endsWith('.html')) {
        content = content.replace(/<head>/i, '<head>\n  <meta name="robots" content="noindex">\n  <script src="' + base + 'demo-adapter.js" data-base="' + base + '"></script>');
      }
      await writeFile(target, content);
    } else await copyFile(file, target);
    count++;
  }
}
await mkdir(output, { recursive: true });
await build(source);
await copyFile(path.join(root, 'demo', 'adapter.js'), path.join(output, 'demo-adapter.js'));
await writeFile(path.join(output, '.nojekyll'), '');
console.log('Built ' + count + ' interface assets for ' + base + '. API actions stay in this browser tab.');
