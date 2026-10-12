import { writeSync } from 'node:fs';
import { AutomergeFileCrdtBackend } from '../../src/index.js';
import { captureProjectKnowledge } from '@devmesh/local-store';

const [mode, path, key = 'worker'] = process.argv.slice(2);
if (path === undefined) throw new Error('Missing store path');
const backend = new AutomergeFileCrdtBackend({ path, initialDoc: { entries: {} as Record<string, string> } });
const report = (message: string) => writeSync(1, `${message}\n`);

if (mode !== 'capture') await backend.load();
report('ready');
await new Promise<void>((resolve) => process.once('message', () => resolve()));

if (mode === 'hold') {
  await backend.change({
    actorId: key,
    summary: 'Hold transaction until terminated',
    mutate(doc) {
      report('locked');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      return doc;
    }
  });
} else if (mode === 'capture') {
  for (let index = 0; index < 4; index += 1) {
    await captureProjectKnowledge(path, {
      id: `${key}_${index}`,
      type: 'decision',
      title: `Concurrent ${key} ${index}`,
      summary: 'Captured from an independent process'
    });
  }
} else {
  await backend.change({ actorId: key, summary: key, mutate(doc) { doc.entries[key] = key; return doc; } });
}
report('done');
process.disconnect?.();
