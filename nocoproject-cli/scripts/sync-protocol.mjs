// Copies the shared protocol types from the application into this package.
// `protocol.phase1-iter{2,3}-server.ts` hold server-only composite types and are not copied; their re-exports are dropped.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = resolve(import.meta.dirname, '../../nocoproject/server/modules/shared');
const target = resolve(import.meta.dirname, '../src');
const files = ['protocol.ts', 'protocol.phase1-iter2.ts', 'protocol.phase1-iter3.ts'];
for (const file of files) {
  let text = readFileSync(resolve(source, file), 'utf8');
  text = text.replace(/^export \* from '\.\/protocol\.phase1-iter[23]-server\.js';\n/gm, '');
  writeFileSync(resolve(target, file), text);
  console.log(`synced ${file}`);
}
