import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { buildSync } from 'esbuild';
const root = resolve(import.meta.dirname, '..');
const read = path => readFileSync(resolve(root, path), 'utf8');
mkdirSync(resolve(root, '.cache'), { recursive: true });
execFileSync(process.execPath, [resolve(root, 'node_modules/tailwindcss/lib/cli.js'), '-i', resolve(root, 'src/styles.css'), '-o', resolve(root, '.cache/styles.css'), '--minify'], { cwd: root, stdio: 'inherit' });
const font = readFileSync(resolve(root, 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')).toString('base64');
const css = read('.cache/styles.css').replace('__INTER_FONT__', font);
const safeScript = text => text.replace(/<\/script/gi, '<\\/script').replace(/\/\/# sourceMappingURL=[^\n]+/g, '');
const libraries = [
  ['PapaParse 5.5.3 — MIT', 'node_modules/papaparse/papaparse.min.js'],
  ['Lucide 0.468.0 — ISC', 'node_modules/lucide/dist/umd/lucide.min.js'],
  ['SheetJS 0.20.3 — Apache-2.0; distribution npm @e965/xlsx', 'node_modules/@e965/xlsx/dist/xlsx.full.min.js']
].map(([name, path]) => `/* ${name} */\n${safeScript(read(path))}`).join('\n');
const licenses = [
  ['PapaParse', 'node_modules/papaparse/LICENSE'],
  ['Lucide', 'node_modules/lucide/LICENSE'],
  ['SheetJS', 'node_modules/@e965/xlsx/LICENSE'],
  ['Inter — SIL Open Font License', 'node_modules/@fontsource-variable/inter/LICENSE']
].map(([name, path]) => `${name}\n${read(path)}`).join('\n\n');
const demo = {
  employees: read('data/LISTES-EMPLOYEES.csv'),
  absences: read('data/LISTES-PERMISSIONS.csv'),
  pointage: read('data/LISTES-POINTAGES.csv'),
  filenames: { employees: 'LISTES-EMPLOYEES.csv', absences: 'LISTES-PERMISSIONS.csv', pointage: 'LISTES-POINTAGES.csv' }
};
const json = JSON.stringify(demo).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const cloud = buildSync({ entryPoints: [resolve(root, 'src/cloud.js')], bundle: true, write: false, platform: 'browser', format: 'iife', target: ['es2022'], minify: true, legalComments: 'inline' }).outputFiles[0].text;
let html = read('src/app.html');
for (const [marker, content] of Object.entries({ CSS: `<style>\n${css}\n</style>`, LIBRARIES: `<script>\n${libraries}\n</script>`, DEMO: `<script>window.VOOMNET_DEMO=${json};</script>`, APP: `<script>\n${safeScript(read('src/core.js') + '\n' + read('src/app.js'))}\n</script>`, CLOUD: `<script>\n${safeScript(cloud)}\n</script>` })) {
  if (!html.includes(`<!-- INLINE:${marker} -->`)) throw new Error(`Missing marker: ${marker}`);
  html = html.replace(`<!-- INLINE:${marker} -->`, () => content);
}
html = html.replace('</head>', () => `<script type="text/plain" id="third-party-licenses">${licenses.replace(/<\/script/gi, '<\\/script')}</script>\n</head>`);
writeFileSync(resolve(root, 'index.html'), html);
console.log(`index.html built: ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MiB. No runtime CDN or network dependency.`);
