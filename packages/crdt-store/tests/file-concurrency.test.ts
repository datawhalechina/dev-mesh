import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import * as files from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { build } from 'tsup';
import * as Automerge from '@automerge/automerge';
import { AutomergeFileCrdtBackend } from '../src/index.js';
import {
  captureProjectKnowledge, ensureProjectStore, initializeProjectCrdtStore,
  loadProjectKnowledgeItemsFromCrdt, rebuildProjectProjectionsFromCrdt, readProjectProjectionStatus
} from '@devmesh/local-store';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

const roots: string[] = [];
const children: ChildProcess[] = [];
const initialDoc = () => ({ entries: {} as Record<string, string> });
const createBackend = (path: string) => new AutomergeFileCrdtBackend({ path, initialDoc });
const put = (backend: ReturnType<typeof createBackend>, key: string) => backend.change({
  actorId: key, summary: key, mutate(doc) { doc.entries[key] = key; return doc; }
});

let fixtureDir: string;
beforeAll(async () => {
  const temporaryRoot = fileURLToPath(new URL('../.tmp/', import.meta.url));
  await mkdir(temporaryRoot, { recursive: true });
  fixtureDir = await mkdtemp(join(temporaryRoot, 'file-worker-'));
  await build({
    entry: [fileURLToPath(new URL('./fixtures/file-worker.ts', import.meta.url)).replaceAll('\\', '/')],
    outDir: fixtureDir,
    format: ['esm'], platform: 'node', target: 'node22',
    tsconfig: resolve('tsconfig.base.json'),
    noExternal: [/^@devmesh\//],
    external: ['@automerge/automerge'],
    config: false, silent: true
  });
}, 30_000);
afterAll(async () => { if (fixtureDir !== undefined) await rm(fixtureDir, { recursive: true, force: true }); });

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'devmesh-file-transactions-'));
  roots.push(root);
  return { root, path: join(root, 'project.automerge') };
}

function worker(mode: string, path: string, key: string) {
  const child = spawn(process.execPath, [
    join(fixtureDir, 'file-worker.js'), mode, path, key
  ], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)),
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true
  });
  children.push(child);
  const lines: string[] = [];
  let stderr = '';
  child.stderr?.on('data', (data) => { stderr += String(data); });
  const output = createInterface({ input: child.stdout! });
  output.on('line', (line) => lines.push(line));
  const exited = once(child, 'exit');
  return {
    child, lines, exited,
    async waitFor(line: string) {
      const deadline = Date.now() + 15_000;
      while (!lines.includes(line)) {
        if (child.exitCode !== null || child.signalCode !== null || Date.now() > deadline) {
          throw new Error(`Worker did not report ${line}: ${lines.join(', ')}\n${stderr}`);
        }
        await delay(10);
      }
    },
    async finish() {
      const [code] = await exited;
      expect(code, stderr).toBe(0);
    }
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('file CRDT transactions', () => {
  it('refreshes preloaded instances before each write', async () => {
    const { path } = await workspace();
    const first = createBackend(path);
    const second = createBackend(path);
    await first.load();
    await second.load();
    await put(first, 'first');
    await put(second, 'second');
    expect((await createBackend(path).load()).entries).toEqual({ first: 'first', second: 'second' });
    expect((await first.load()).entries).toEqual({ first: 'first', second: 'second' });
  });

  it('serializes parallel writes and first initialization on one instance', async () => {
    const { path } = await workspace();
    const backend = createBackend(path);
    await Promise.all(['a', 'b', 'c', 'd'].map((key) => put(backend, key)));
    expect(Object.keys((await createBackend(path).load()).entries).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('retains local changes while applying changes from another replica', async () => {
    const { root, path } = await workspace();
    const local = createBackend(path);
    await local.load();
    const remote = createBackend(join(root, 'remote.automerge'));
    await remote.applyAutomergeChanges(await local.getAllChanges());
    const incoming = await put(remote, 'remote');
    const receiver = createBackend(path);
    await receiver.load();
    await Promise.all([put(local, 'local'), receiver.apply(incoming.change)]);
    expect((await createBackend(path).load()).entries).toEqual({ local: 'local', remote: 'remote' });
  });

  it('applies a non-binary change against the latest file inside the transaction', async () => {
    const { path } = await workspace();
    const backend = createBackend(path);
    await backend.load();
    await put(createBackend(path), 'other');
    const result = await backend.apply({
      id: 'memory-change', actorId: 'memory', createdAt: new Date().toISOString(),
      summary: 'Apply a plain change', headsBefore: [], headsAfter: [],
      apply(doc) { doc.entries.applied = 'applied'; return doc; }
    });
    expect(result.doc.entries).toEqual({ other: 'other', applied: 'applied' });
    expect(result.change.headsAfter).toEqual((await backend.readSnapshot()).heads);
  });

  it('does not replay the previous binary change for a no-op', async () => {
    const { path } = await workspace();
    const backend = createBackend(path);
    await put(backend, 'first');
    const result = await backend.change({ actorId: 'test', summary: 'No change', mutate: (doc) => doc });
    expect(result.change.headsAfter).toEqual(result.change.headsBefore);
    expect(result.change.binaryChanges).toEqual([]);
    await put(backend, 'later');
    await backend.apply(result.change);
    expect((await backend.load()).entries).toEqual({ first: 'first', later: 'later' });
  });

  it('keeps save as an explicit replacement and conditionally saves only missing files', async () => {
    const { path } = await workspace();
    const backend = createBackend(path);
    const seeded = await backend.saveIfAbsent({ entries: { seed: 'seed' } });
    expect(seeded.created).toBe(true);
    await put(backend, 'captured');
    const skipped = await createBackend(path).saveIfAbsent(initialDoc());
    expect(skipped.created).toBe(false);
    expect(skipped.doc.entries).toEqual({ seed: 'seed', captured: 'captured' });
    const replacement = await backend.saveSnapshot({ entries: { replacement: 'replacement' } });
    expect((await backend.readSnapshot()).doc.entries).toEqual({ replacement: 'replacement' });
    await put(backend, 'later');
    expect(replacement.doc.entries).toEqual({ replacement: 'replacement' });
    expect(replacement.heads).not.toEqual((await backend.readSnapshot()).heads);
    await backend.save(initialDoc());
    expect((await backend.load()).entries).toEqual({});
  });

  it('releases a failed transaction without damaging the previous snapshot', async () => {
    const { root, path } = await workspace();
    const backend = createBackend(path);
    await put(backend, 'existing');
    const before = await readFile(path);
    const rename = vi.mocked(files.rename).mockRejectedValueOnce(new Error('Simulated rename failure'));
    await expect(put(backend, 'failed')).rejects.toThrow('Simulated rename failure');
    rename.mockRestore();
    expect(await readFile(path)).toEqual(before);
    expect((await files.readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    await put(backend, 'next');
    expect((await backend.load()).entries).toEqual({ existing: 'existing', next: 'next' });
  });

  it('returns changes and heads from one snapshot while writes continue', async () => {
    const { path } = await workspace();
    const backend = createBackend(path);
    await backend.load();
    await Promise.all(Array.from({ length: 8 }, async (_, index) => {
      await put(backend, `key_${index}`);
      const snapshot = await backend.readChangesSnapshot();
      const [replayed] = Automerge.applyChanges(Automerge.init(), snapshot.changes);
      expect(Automerge.getHeads(replayed)).toEqual(snapshot.heads);
      expect(Automerge.getAllChanges(replayed)).toHaveLength(snapshot.changeCount);
    }));
  });

  it('keeps every read parseable during repeated atomic replacements', async () => {
    const { path } = await workspace();
    const backend = createBackend(path);
    await backend.load();
    let done = false;
    const writing = (async () => {
      try {
        for (let index = 0; index < 10; index += 1) {
          await backend.change({
            actorId: 'writer', summary: String(index),
            mutate(doc) { doc.entries[String(index)] = 'content'.repeat(10_000); return doc; }
          });
        }
      } finally { done = true; }
    })();
    void writing.catch(() => {});
    let reads = 0;
    try {
      while (!done) {
        const snapshot = await createBackend(path).readSnapshot();
        expect(Object.values(snapshot.doc.entries).every((value) => value === 'content'.repeat(10_000))).toBe(true);
        reads += 1;
      }
    } finally { await writing; }
    expect(reads).toBeGreaterThan(0);
    expect(Object.keys((await backend.load()).entries)).toHaveLength(10);
  }, 30_000);

  it('shares transactions across directory aliases', async () => {
    const { root } = await workspace();
    const directory = join(root, 'real');
    const alias = join(root, 'alias');
    await mkdir(directory);
    await files.symlink(directory, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const first = createBackend(join(directory, 'project.automerge'));
    const second = createBackend(join(alias, 'project.automerge'));
    await Promise.all([put(first, 'real'), put(second, 'alias')]);
    expect((await first.load()).entries).toEqual({ real: 'real', alias: 'alias' });
  });

  it('keeps all acknowledged captures and rebuilds matching projections', async () => {
    const { root } = await workspace();
    const store = await ensureProjectStore(root, { projectKey: 'parallel' });
    await initializeProjectCrdtStore(root);
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => captureProjectKnowledge(root, {
      id: `kn_${index}`, type: 'decision', title: `Capture ${index}`, summary: 'Parallel capture'
    })));
    const expectedIds = results.map(({ item }) => item.id).sort();
    expect((await loadProjectKnowledgeItemsFromCrdt(root)).map(({ id }) => id).sort()).toEqual(expectedIds);
    const jsonl = await readFile(join(store.paths.knowledgeDir, 'extract', 'entries.jsonl'), 'utf8');
    expect(jsonl.trim().split('\n').map((line) => JSON.parse(line).id).sort()).toEqual(expectedIds);
    const projection = await rebuildProjectProjectionsFromCrdt(root);
    expect(projection.documentCount).toBe(expectedIds.length);
    expect((await readProjectProjectionStatus(root)).state).toBe('ready');
  });

  it('retains captures made by independent processes sharing a store', async () => {
    const { root } = await workspace();
    await ensureProjectStore(root, { projectKey: 'processes' });
    await initializeProjectCrdtStore(root);
    const workers = ['a', 'b', 'c'].map((key) => worker('capture', root, key));
    await Promise.all(workers.map((child) => child.waitFor('ready')));
    for (const child of workers) child.child.send('go');
    await Promise.all(workers.map((child) => child.finish()));
    const ids = (await loadProjectKnowledgeItemsFromCrdt(root)).map(({ id }) => id).sort();
    expect(ids).toEqual(['a', 'b', 'c'].flatMap((key) => Array.from({ length: 4 }, (_, index) => `${key}_${index}`)));
  }, 30_000);

  it('waits for a live owner and recovers after that process is terminated', async () => {
    const { path } = await workspace();
    await put(createBackend(path), 'existing');
    const holder = worker('hold', path, 'holder');
    await holder.waitFor('ready');
    holder.child.send('go');
    await holder.waitFor('locked');
    const waiter = worker('write', path, 'waiter');
    await waiter.waitFor('ready');
    waiter.child.send('go');
    await delay(250);
    expect(waiter.lines).not.toContain('done');
    holder.child.kill('SIGKILL');
    await holder.exited;
    await waiter.finish();
    expect((await createBackend(path).load()).entries).toEqual({ existing: 'existing', waiter: 'waiter' });
  }, 30_000);
});
