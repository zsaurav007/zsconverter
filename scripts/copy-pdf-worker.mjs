import { copyFile, cp, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const root = path.dirname(require.resolve('pdfjs-dist/package.json'));
await mkdir('public/pdfjs', { recursive: true });
await copyFile(path.join(root, 'build/pdf.worker.min.mjs'), 'public/pdf.worker.min.mjs');
for (const name of ['standard_fonts', 'cmaps', 'wasm']) await cp(path.join(root, name), path.join('public/pdfjs', name), { recursive: true });
console.log('Copied matching PDF.js worker, standard fonts, CMaps and WASM assets into public/.');
