import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import * as crdtStore from '@devmesh/crdt-store';
import { createKnowledgeItem } from '@devmesh/core';
import {
  captureProjectKnowledge, ensureProjectStore, importProjectJsonlToCrdt, loadProjectKnowledgeItemsFromCrdt,
  upsertProjectKnowledgeToCrdt
} from '../src/index.js';

it('does not overwrite a capture committed while a JSONL import was being prepared', async () => {
  const root = await mkdtemp(join(tmpdir(), 'devmesh-import-race-'));
  let release!: () => void;
  const proceed = new Promise<void>((resolve) => { release = resolve; });
  let prepared!: () => void;
  const preparation = new Promise<void>((resolve) => { prepared = resolve; });
  const original = crdtStore.importV1JsonlToProjectDoc;
  const importing = vi.spyOn(crdtStore, 'importV1JsonlToProjectDoc').mockImplementation(async (input) => {
    const result = await original(input);
    prepared();
    await proceed;
    return result;
  });
  let pending: ReturnType<typeof importProjectJsonlToCrdt> | undefined;
  try {
    await ensureProjectStore(root, { projectKey: 'import-race' });
    pending = importProjectJsonlToCrdt(root);
    await preparation;
    const capture = await captureProjectKnowledge(root, {
      id: 'captured_during_import', type: 'decision', title: 'New knowledge', summary: 'Must survive import'
    });
    release();
    const result = await pending;
    expect(result.importedKnowledge).toBe(0);
    expect(result.doc.knowledge[capture.item.id]).toBeDefined();
    expect((await loadProjectKnowledgeItemsFromCrdt(root)).map(({ id }) => id)).toContain(capture.item.id);
  } finally {
    release();
    await pending?.catch(() => {});
    importing.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});

it('checks repeated upserts against the current transaction snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'devmesh-upsert-transaction-'));
  try {
    const item = createKnowledgeItem({ id: 'same', type: 'decision', title: 'Same item', summary: 'Same content' });
    const first = await upsertProjectKnowledgeToCrdt(root, item);
    const repeated = await Promise.all(Array.from({ length: 3 }, () => upsertProjectKnowledgeToCrdt(root, item)));
    for (const result of repeated) expect(result.heads).toEqual(first.heads);
    const other = await upsertProjectKnowledgeToCrdt(root, createKnowledgeItem({
      id: 'other', type: 'decision', title: 'Other item', summary: 'Independent content'
    }));
    const result = await upsertProjectKnowledgeToCrdt(root, item);
    expect(result.heads).toEqual(other.heads);
    expect(Object.keys(result.doc.knowledge).sort()).toEqual(['other', 'same']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
