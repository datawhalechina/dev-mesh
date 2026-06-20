import { access, appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createKnowledgeId, type KnowledgeLayer } from '@devmesh/core';
import { nowIso } from '@devmesh/shared';

export function getKnowledgeFile(knowledgeDir: string, layer: KnowledgeLayer): string {
  if (layer === 'raw') {
    return join(knowledgeDir, 'raw', `${nowIso().slice(0, 7)}.jsonl`);
  }

  return join(knowledgeDir, layer, 'entries.jsonl');
}

export function getKnowledgeRatingFile(knowledgeDir: string, createdAt: string): string {
  return join(knowledgeDir, 'ratings', `${createdAt.slice(0, 7)}.jsonl`);
}

export function getKnowledgeUsageFile(knowledgeDir: string, createdAt: string): string {
  return join(knowledgeDir, 'usage', `${createdAt.slice(0, 7)}.jsonl`);
}

export function getKnowledgeEdgeFile(knowledgeDir: string): string {
  return join(knowledgeDir, 'edges.jsonl');
}

export function getPendingQueueFile(queueDir: string): string {
  return join(queueDir, 'pending.jsonl');
}

export function getRejectedQueueFile(queueDir: string): string {
  return join(queueDir, 'rejected.jsonl');
}

export function getKnowledgeProjectionFile(indexDir: string): string {
  return join(indexDir, 'knowledge.sqlite');
}

export function getSearchProjectionFile(indexDir: string): string {
  return join(indexDir, 'search.sqlite');
}

export function getSqliteIndexFile(indexDir: string): string {
  return getSearchProjectionFile(indexDir);
}

export function getKnowledgeGraphIndexFile(indexDir: string): string {
  return join(indexDir, 'graph.sqlite');
}

export function getProjectQualityProjectionFile(indexDir: string): string {
  return join(indexDir, 'quality.json');
}

export function getProjectionMetadataFile(indexDir: string): string {
  return join(indexDir, 'projection-meta.json');
}

export function createKnowledgeIdForLayer(layer: KnowledgeLayer): string {
  if (layer === 'canonical') {
    return createKnowledgeId('can');
  }

  if (layer === 'raw') {
    return createKnowledgeId('raw');
  }

  return createKnowledgeId('ki');
}

export async function appendJsonLine(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(value)}\n`, 'utf8');
}

export async function readJsonl<T>(path: string): Promise<T[]> {
  const content = await readFile(path, 'utf8');
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export async function writeJsonl<T>(path: string, values: T[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const content = values.map((value) => JSON.stringify(value)).join('\n');
  await writeFile(path, content ? `${content}\n` : '', 'utf8');
}

export async function writeFileIfMissing(path: string, content: string): Promise<void> {
  try {
    await access(path);
  } catch {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function walkJsonlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walkJsonlFiles(path)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(path);
    }
  }

  return files.sort();
}

export async function walkKnowledgeItemFiles(knowledgeDir: string): Promise<string[]> {
  const layers = ['raw', 'extract', 'canonical'];
  const files: string[] = [];

  for (const layer of layers) {
    const layerDir = join(knowledgeDir, layer);

    if (await pathExists(layerDir)) {
      files.push(...(await walkJsonlFiles(layerDir)));
    }
  }

  return files.sort();
}

export function escapeToml(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
