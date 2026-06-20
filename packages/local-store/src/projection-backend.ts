import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { KnowledgeItem } from '@devmesh/core';
import type { QualitySignal } from '@devmesh/crdt-store';
import type { KnowledgeGraphSemanticEdge } from '@devmesh/graph';
import { clamp01 } from '@devmesh/shared';
import {
  getKnowledgeGraphIndexFile,
  getKnowledgeProjectionFile,
  getProjectQualityProjectionFile,
  getProjectionMetadataFile,
  getSearchProjectionFile,
  getSqliteIndexFile,
  pathExists
} from './files.js';
import { rebuildProjectIndexFromItems } from './indexer.js';
import {
  PROJECT_STORE_SCHEMA_VERSION,
  type ProjectedKnowledgeQuality,
  type ProjectQualityProjection,
  type ProjectProjectionFileStatus,
  type ProjectProjectionMetadata,
  type ProjectProjectionStatus,
  type ProjectProjectionStatusState,
  type RebuildProjectProjectionResult
} from './types.js';

export const QUALITY_PROJECTION_ALGORITHM_VERSION = 1;
const requireNodeBuiltin = createRequire(import.meta.url);

export interface ProjectionRebuildInput {
  crdtPath: string;
  sourceHeads: string[];
  items: KnowledgeItem[];
  semanticEdges?: KnowledgeGraphSemanticEdge[];
  qualitySignals?: QualitySignal[];
}

export interface ProjectionChangeInput {
  crdtPath: string;
  sourceHeads: string[];
  items: KnowledgeItem[];
  semanticEdges?: KnowledgeGraphSemanticEdge[];
  qualitySignals?: QualitySignal[];
}

export interface ProjectionBackend {
  readonly name: string;
  readonly schemaVersion: number;
  readonly metadataPath: string;

  sourceHeads(): Promise<string[]>;
  rebuild(input: ProjectionRebuildInput): Promise<RebuildProjectProjectionResult>;
  applyIncrementalChange(input: ProjectionChangeInput): Promise<RebuildProjectProjectionResult>;
  healthCheck(input: { crdtPath: string; currentHeads: string[] }): Promise<ProjectProjectionStatus>;
  dropAndRebuild(input: ProjectionRebuildInput): Promise<RebuildProjectProjectionResult>;
}

export interface LocalProjectionBackendOptions {
  indexDir: string;
}

export class LocalProjectionBackend implements ProjectionBackend {
  readonly name = 'local-sqlite-json';
  readonly schemaVersion = PROJECT_STORE_SCHEMA_VERSION;
  readonly metadataPath: string;

  private readonly indexDir: string;

  constructor(options: LocalProjectionBackendOptions) {
    this.indexDir = options.indexDir;
    this.metadataPath = getProjectionMetadataFile(options.indexDir);
  }

  async sourceHeads(): Promise<string[]> {
    let metadata: ProjectProjectionMetadata | undefined;

    try {
      metadata = await readProjectProjectionMetadata(this.metadataPath);
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }

      return [];
    }

    return metadata?.sourceHeads ?? [];
  }

  async rebuild(input: ProjectionRebuildInput): Promise<RebuildProjectProjectionResult> {
    const rebuilt = await rebuildProjectIndexFromItems(this.indexDir, input.items, input.semanticEdges ?? []);
    const quality = await writeProjectQualityProjection({
      indexDir: this.indexDir,
      rebuiltAt: rebuilt.rebuiltAt,
      sourceHeads: input.sourceHeads,
      items: input.items,
      qualitySignals: input.qualitySignals ?? []
    });
    const projectionFiles = await this.inspectProjectionFiles();

    await writeProjectProjectionMetadata(this.metadataPath, {
      schemaVersion: this.schemaVersion,
      backend: this.name,
      source: input.crdtPath,
      sourceHeads: input.sourceHeads,
      rebuiltAt: rebuilt.rebuiltAt,
      documentCount: rebuilt.documentCount,
      graphNodeCount: rebuilt.graphNodeCount,
      graphEdgeCount: rebuilt.graphEdgeCount,
      qualityCount: quality.qualityCount,
      qualityAlgorithmVersion: QUALITY_PROJECTION_ALGORITHM_VERSION,
      qualityPath: quality.path,
      projectionFiles
    });

    return {
      ...rebuilt,
      qualityPath: quality.path,
      qualityCount: quality.qualityCount,
      qualityAlgorithmVersion: QUALITY_PROJECTION_ALGORITHM_VERSION
    };
  }

  async applyIncrementalChange(input: ProjectionChangeInput): Promise<RebuildProjectProjectionResult> {
    return this.rebuild(input);
  }

  async healthCheck(input: { crdtPath: string; currentHeads: string[] }): Promise<ProjectProjectionStatus> {
    let metadata: ProjectProjectionMetadata | undefined;
    let metadataCorrupt = false;

    try {
      metadata = await readProjectProjectionMetadata(this.metadataPath);
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }

      metadataCorrupt = true;
    }

    const projectionFiles = await this.inspectProjectionFiles();

    if (metadataCorrupt) {
      return {
        state: 'corrupt',
        backend: this.name,
        schemaVersion: this.schemaVersion,
        expectedSchemaVersion: this.schemaVersion,
        metadataPath: this.metadataPath,
        crdtPath: input.crdtPath,
        currentHeads: input.currentHeads,
        sourceHeads: [],
        projectionFiles: [
          {
            path: this.metadataPath,
            role: 'metadata',
            state: 'corrupt',
            expectedSchemaVersion: this.schemaVersion,
            message: 'Projection metadata file is not valid JSON.'
          },
          ...projectionFiles
        ],
        message: 'Projection metadata is corrupt; rebuild projections from CRDT.'
      };
    }

    if (metadata === undefined) {
      return {
        state: 'missing',
        backend: this.name,
        schemaVersion: this.schemaVersion,
        expectedSchemaVersion: this.schemaVersion,
        metadataPath: this.metadataPath,
        crdtPath: input.crdtPath,
        currentHeads: input.currentHeads,
        sourceHeads: [],
        projectionFiles,
        message: 'Projection metadata is missing; rebuild projections from CRDT.'
      };
    }

    const metadataFileStatus: ProjectProjectionFileStatus = {
      path: this.metadataPath,
      role: 'metadata',
      state: metadata.schemaVersion === this.schemaVersion ? 'ready' : 'schema_mismatch',
      schemaVersion: metadata.schemaVersion,
      expectedSchemaVersion: this.schemaVersion
    };
    const files = [metadataFileStatus, ...projectionFiles];
    const fileFailure = files.find((file) => file.state !== 'ready');

    if (metadata.schemaVersion !== this.schemaVersion) {
      return this.formatStatus({
        state: 'schema_mismatch',
        metadata,
        currentHeads: input.currentHeads,
        crdtPath: input.crdtPath,
        projectionFiles: files,
        message: `Projection metadata schema ${metadata.schemaVersion} does not match supported schema ${this.schemaVersion}; rebuild projections from CRDT.`
      });
    }

    if (fileFailure !== undefined) {
      const state: ProjectProjectionStatusState = fileFailure.state === 'missing' ? 'missing' : fileFailure.state;

      return this.formatStatus({
        state,
        metadata,
        currentHeads: input.currentHeads,
        crdtPath: input.crdtPath,
        projectionFiles: files,
        message: `Projection file ${fileFailure.path} is ${fileFailure.state}; rebuild projections from CRDT.`
      });
    }

    const ready = sameStringSet(input.currentHeads, metadata.sourceHeads);

    return this.formatStatus({
      state: ready ? 'ready' : 'dirty',
      metadata,
      currentHeads: input.currentHeads,
      crdtPath: input.crdtPath,
      projectionFiles: files,
      message: ready
        ? 'Projections are up to date with the CRDT document heads.'
        : 'CRDT document heads differ from the last projection rebuild.'
    });
  }

  async dropAndRebuild(input: ProjectionRebuildInput): Promise<RebuildProjectProjectionResult> {
    return this.rebuild(input);
  }

  private async inspectProjectionFiles(): Promise<ProjectProjectionFileStatus[]> {
    const manifestPath = join(this.indexDir, 'manifest.json');
    const knowledgePath = getKnowledgeProjectionFile(this.indexDir);
    const searchPath = getSearchProjectionFile(this.indexDir);
    const graphPath = getKnowledgeGraphIndexFile(this.indexDir);
    const qualityPath = getProjectQualityProjectionFile(this.indexDir);
    const manifest = await inspectJsonProjectionFile(manifestPath, 'manifest', this.schemaVersion);
    const knowledge = await inspectSqliteProjectionFile(knowledgePath, 'knowledge', this.schemaVersion);
    const search = await inspectSqliteProjectionFile(searchPath, 'search', this.schemaVersion);
    const graph = await inspectSqliteProjectionFile(graphPath, 'graph', this.schemaVersion);
    const quality = await inspectJsonProjectionFile(qualityPath, 'quality', this.schemaVersion);

    return [manifest, knowledge, search, graph, quality];
  }

  private formatStatus(input: {
    state: ProjectProjectionStatusState;
    metadata: ProjectProjectionMetadata;
    currentHeads: string[];
    crdtPath: string;
    projectionFiles: ProjectProjectionFileStatus[];
    message: string;
  }): ProjectProjectionStatus {
    const status: ProjectProjectionStatus = {
      state: input.state,
      backend: input.metadata.backend ?? this.name,
      schemaVersion: input.metadata.schemaVersion,
      expectedSchemaVersion: this.schemaVersion,
      metadataPath: this.metadataPath,
      crdtPath: input.crdtPath,
      currentHeads: input.currentHeads,
      sourceHeads: input.metadata.sourceHeads,
      projectionFiles: input.projectionFiles,
      message: input.message,
      rebuiltAt: input.metadata.rebuiltAt,
      documentCount: input.metadata.documentCount,
      graphNodeCount: input.metadata.graphNodeCount,
      graphEdgeCount: input.metadata.graphEdgeCount
    };

    if (input.metadata.qualityCount !== undefined) {
      status.qualityCount = input.metadata.qualityCount;
    }

    if (input.metadata.qualityAlgorithmVersion !== undefined) {
      status.qualityAlgorithmVersion = input.metadata.qualityAlgorithmVersion;
    }

    if (input.metadata.qualityPath !== undefined) {
      status.qualityPath = input.metadata.qualityPath;
    }

    return status;
  }
}

export async function readProjectQualityProjection(path: string): Promise<ProjectQualityProjection | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as ProjectQualityProjection;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
}

export async function readProjectProjectionMetadata(path: string): Promise<ProjectProjectionMetadata | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as ProjectProjectionMetadata;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
}

async function writeProjectProjectionMetadata(path: string, metadata: ProjectProjectionMetadata): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

async function writeProjectQualityProjection(input: {
  indexDir: string;
  rebuiltAt: string;
  sourceHeads: string[];
  items: KnowledgeItem[];
  qualitySignals: QualitySignal[];
}): Promise<{ path: string; qualityCount: number }> {
  const path = getProjectQualityProjectionFile(input.indexDir);
  const qualities = projectKnowledgeQuality(input.items, input.qualitySignals, input.rebuiltAt);
  const projection: ProjectQualityProjection = {
    schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
    algorithmVersion: QUALITY_PROJECTION_ALGORITHM_VERSION,
    rebuiltAt: input.rebuiltAt,
    sourceHeads: input.sourceHeads,
    qualityCount: Object.keys(qualities).length,
    qualities
  };

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(projection, null, 2)}\n`, 'utf8');

  return {
    path,
    qualityCount: projection.qualityCount
  };
}

function projectKnowledgeQuality(
  items: KnowledgeItem[],
  signals: QualitySignal[],
  rebuiltAt: string
): Record<string, ProjectedKnowledgeQuality> {
  const byKnowledgeId = new Map<string, QualitySignal[]>();

  for (const signal of signals) {
    const existing = byKnowledgeId.get(signal.knowledgeId) ?? [];
    existing.push(signal);
    byKnowledgeId.set(signal.knowledgeId, existing);
  }

  return Object.fromEntries(
    items.map((item) => {
      const projected = projectSingleKnowledgeQuality(item, byKnowledgeId.get(item.id) ?? [], rebuiltAt);

      return [item.id, projected];
    })
  );
}

function projectSingleKnowledgeQuality(
  item: KnowledgeItem,
  signals: QualitySignal[],
  rebuiltAt: string
): ProjectedKnowledgeQuality {
  let reliability = clamp01(
    item.quality.confidence * 0.45 + item.quality.sourceTrust * 0.3 + item.quality.evidence * 0.25
  );
  let usefulness = clamp01(item.quality.rating * 0.45 + item.quality.adoptionScore * 0.55);
  let freshness = clamp01(item.quality.freshness);
  let priority = clamp01(item.quality.weight);

  for (const signal of signals) {
    const value = signal.value ?? defaultSignalValue(signal.kind);

    if (signal.kind === 'confirm') {
      reliability = clamp01(reliability + value * 0.25);
    } else if (signal.kind === 'dispute') {
      reliability = clamp01(reliability - Math.abs(value) * 0.35);
    } else if (signal.kind === 'use') {
      usefulness = clamp01(usefulness + value * 0.4);
    } else if (signal.kind === 'rate') {
      usefulness = clamp01(usefulness * 0.5 + clamp01(value) * 0.5);
    } else if (signal.kind === 'demote') {
      const demotion = Math.abs(value);
      reliability = clamp01(reliability - demotion * 0.15);
      priority = clamp01(priority - demotion * 0.35);
    } else if (signal.kind === 'stale') {
      freshness = clamp01(freshness - Math.abs(value) * 0.45);
    } else if (signal.kind === 'refresh') {
      freshness = clamp01(freshness + value * 0.45);
    }
  }

  const score = clamp01(reliability * 0.35 + usefulness * 0.3 + freshness * 0.2 + priority * 0.15);

  return {
    knowledgeId: item.id,
    reliability,
    usefulness,
    freshness,
    priority,
    score,
    signalCount: signals.length,
    updatedAt: latestIso([item.updatedAt, rebuiltAt, ...signals.map((signal) => signal.createdAt)])
  };
}

function defaultSignalValue(kind: QualitySignal['kind']): number {
  if (kind === 'dispute' || kind === 'demote' || kind === 'stale') {
    return 0.1;
  }

  return 0.1;
}

function latestIso(values: string[]): string {
  return values.reduce((latest, value) => (value > latest ? value : latest), values[0] ?? new Date(0).toISOString());
}

async function inspectSqliteProjectionFile(
  path: string,
  role: ProjectProjectionFileStatus['role'],
  expectedSchemaVersion: number
): Promise<ProjectProjectionFileStatus> {
  if (!(await pathExists(path))) {
    return {
      path,
      role,
      state: 'missing',
      expectedSchemaVersion,
      message: `Projection ${role} file is missing.`
    };
  }

  let db: DatabaseSync | undefined;

  try {
    db = openSqliteDatabase(path);
    const schemaVersionValue = readSqliteMetadata(db, 'schemaVersion');
    const roleValue = readSqliteMetadata(db, 'role');
    const schemaVersion = Number(schemaVersionValue);
    const output: ProjectProjectionFileStatus = {
      path,
      role,
      state: 'ready',
      schemaVersion,
      expectedSchemaVersion
    };

    if (schemaVersion !== expectedSchemaVersion) {
      return {
        ...output,
        state: 'schema_mismatch',
        message: `Projection ${role} schema does not match supported schema ${expectedSchemaVersion}.`
      };
    }

    if (roleValue !== role) {
      return {
        ...output,
        state: 'schema_mismatch',
        message: `Projection ${role} metadata role is ${roleValue}; expected ${role}.`
      };
    }

    return output;
  } catch (error) {
    return {
      path,
      role,
      state: 'corrupt',
      expectedSchemaVersion,
      message: `Projection ${role} SQLite file is not readable: ${serializeError(error)}`
    };
  } finally {
    db?.close();
  }
}

async function inspectJsonProjectionFile(
  path: string,
  role: ProjectProjectionFileStatus['role'],
  expectedSchemaVersion: number
): Promise<ProjectProjectionFileStatus> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as { schemaVersion?: unknown };
    const schemaVersion = typeof value.schemaVersion === 'number' ? value.schemaVersion : undefined;

    if (schemaVersion !== expectedSchemaVersion) {
      const output: ProjectProjectionFileStatus = {
        path,
        role,
        state: 'schema_mismatch',
        expectedSchemaVersion,
        message: `Projection ${role} schema does not match supported schema ${expectedSchemaVersion}.`
      };

      if (schemaVersion !== undefined) {
        output.schemaVersion = schemaVersion;
      }

      return output;
    }

    return {
      path,
      role,
      state: 'ready',
      schemaVersion: expectedSchemaVersion,
      expectedSchemaVersion
    };
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return {
        path,
        role,
        state: 'missing',
        expectedSchemaVersion,
        message: `Projection ${role} file is missing.`
      };
    }

    if (error instanceof SyntaxError) {
      return {
        path,
        role,
        state: 'corrupt',
        expectedSchemaVersion,
        message: `Projection ${role} file is not valid JSON.`
      };
    }

    throw error;
  }
}

function openSqliteDatabase(path: string): DatabaseSync {
  const sqlite = requireNodeBuiltin('node:sqlite') as typeof import('node:sqlite');

  return new sqlite.DatabaseSync(path);
}

function readSqliteMetadata(db: DatabaseSync, key: string): string {
  const row = db.prepare('SELECT value FROM projection_metadata WHERE key = ?').get(key);

  if (!isPlainRecord(row) || typeof row.value !== 'string') {
    throw new Error(`Missing SQLite projection metadata key "${key}".`);
  }

  return row.value;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const rightSet = new Set(right);

  return left.every((value) => rightSet.has(value));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function serializeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
