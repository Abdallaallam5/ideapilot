'use strict';

/**
 * Copies the browser libraries the pages load into public/vendor, so they are served
 * like any other static file (Vercel does not ship node_modules assets with the app).
 * Run after upgrading bootstrap, cytoscape, lucide or @fontsource/cairo:
 *   npm run vendor
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const mod = (p) => path.join(root, 'node_modules', p);
const out = (p) => path.join(root, 'public', 'vendor', p);

const files = [
  ['bootstrap/dist/css/bootstrap.min.css', 'bootstrap/css/bootstrap.min.css'],
  ['bootstrap/dist/css/bootstrap.rtl.min.css', 'bootstrap/css/bootstrap.rtl.min.css'],
  ['bootstrap/dist/js/bootstrap.bundle.min.js', 'bootstrap/js/bootstrap.bundle.min.js'],
  ['cytoscape/dist/cytoscape.min.js', 'cytoscape/cytoscape.min.js'],
  ['lucide/dist/umd/lucide.min.js', 'lucide/lucide.min.js'],
  ...['400', '600', '700'].map((w) => [`@fontsource/cairo/${w}.css`, `fonts/cairo/${w}.css`]),
];

fs.rmSync(out(''), { recursive: true, force: true });
for (const [from, to] of files) {
  fs.mkdirSync(path.dirname(out(to)), { recursive: true });
  fs.copyFileSync(mod(from), out(to));
}
// The Cairo stylesheets point at ./files/*.woff2 and *.woff.
fs.cpSync(mod('@fontsource/cairo/files'), out('fonts/cairo/files'), { recursive: true });
process.stdout.write(`Copied ${files.length} files and the Cairo fonts into public/vendor\n`);
