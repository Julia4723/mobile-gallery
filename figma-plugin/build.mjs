// Сборка плагина: dist/code.js (main-поток) и dist/ui.html (iframe со встроенным скриптом).
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2017',
  outfile: 'dist/code.js',
});

const ui = await build({
  entryPoints: ['src/ui.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  write: false,
});
const script = ui.outputFiles[0].text.replaceAll('</script', '<\\/script');
const template = await readFile('src/ui.html', 'utf8');
await writeFile('dist/ui.html', template.replace('/*SCRIPT*/', () => script));

console.log('Собрано: dist/code.js, dist/ui.html');
