// Works around a Windows startup bug in the IWSDK 1.1 release candidate:
// the dev tools give PowerShell only 1.5 seconds to answer, and PowerShell
// often takes longer than that to start, so `npm run dev` fails with
// "Cannot establish this process birth identity". This raises the limit.
// Runs automatically after `npm install`; safe to run more than once.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const files = [
  'node_modules/@iwsdk/vite-plugin-dev/dist/index.js',
  'node_modules/@iwsdk/cli/dist/cli.js',
  'node_modules/@iwsdk/cli/dist/index.js',
  'node_modules/@iwsdk/cli/dist/runtime-files.js',
  'node_modules/@iwsdk/cli/dist/runtime-owner.js',
];
const pattern = /(Get-Process -Id \$\{pid\}[\s\S]{0,200}?timeout: )1500/g;

let patched = 0;
for (const file of files) {
  if (!existsSync(file)) continue;
  const src = readFileSync(file, 'utf8');
  const out = src.replace(pattern, '$120000');
  if (out !== src) {
    writeFileSync(file, out);
    patched++;
  }
}
console.log(`[jam-along] Windows PowerShell timeout fix applied to ${patched} file(s).`);
