import { mkdir, cp, access } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
await mkdir('dist/vendor', { recursive: true });
for (const filename of ['sql-wasm.js','sql-wasm.wasm']) {
  await access(`node_modules/sql.js/dist/${filename}`);
  await cp(`node_modules/sql.js/dist/${filename}`, `dist/vendor/${filename}`);
}
console.log('SQL Lab UI + local SQL.js WASM -> dist/. API -> Vercel Functions.');
