// Copies the shared protocol types from the application into this package.
// `protocol.phase1-iter2-server.ts` holds server-only composite types and is not copied; its re-export is dropped.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = resolve(import.meta.dirname, '../../nocoproject/server/modules/shared');
const target = resolve(import.meta.dirname, '../src');
const files = ['protocol.ts', 'protocol.phase1-iter2.ts'];
for (const file of files) {
  let text = readFileSync(resolve(source, file), 'utf8');
  text = text.replace(/^export \* from '\.\/protocol\.phase1-iter2-server\.js';\n/m, '');
  writeFileSync(resolve(target, file), text);
  console.log(`synced ${file}`);
}
