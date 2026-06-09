import { randomUUID } from 'node:crypto';
import type { ExtensionRegistry } from '@devmesh/extension-api';
import { clamp01, invariant, nowIso } from '@devmesh/shared';

export type KnowledgeLayer = 'raw' | 'extract' | 'canonical';
export type ParaCategory = 'projects' | 'areas' | 'resources' | 'archives';
export type KnowledgeVisibility = 'private' | 'project' | 'team' | 'org';
export type KnowledgeStatus = 'active' | 'superseded' | 'tombstone';

export type KnowledgeType =
  | 'decision'
  | 'convention'
  | 'task'
  | 'pitfall'
  | 'command'
  | 'glossary'
  | 'runbook'
  | 'adr'
  | 'note'
  | string;

export interface ParaRef {
  category: ParaCategory;
  key: string;
}

export interface KnowledgeSource {
  kind: string;
  ref?: string;
  url?: string;
  commit?: string;
  storageRef?: string;
  metadata?: Record<string, unknown>;
}

export interface MemberIdentity {
  memberId?: string;
  displayName: string;
  handle?: string;
  clientId?: string;
}

export interface QualitySignals {
  confidence: number;
  weight: number;
  rating: number;
  adoptionScore: number;
  sourceTrust: number;
  evidence: number;
  freshness: number;
  qualityScore: number;
}

export interface KnowledgeItem {
  id: string;
  layer: KnowledgeLayer;
  entryKey: string;
  type: KnowledgeType;
  title: string;
  summary: string;
  content?: string;
  para: ParaRef;
  tags: string[];
  source: KnowledgeSource;
  createdBy: MemberIdentity;
  createdAt: string;
  updatedAt: string;
  visibility: KnowledgeVisibility;
  status: KnowledgeStatus;
  quality: QualitySignals;
}

export interface CaptureKnowledgeInput {
  id?: string;
  layer?: KnowledgeLayer;
  entryKey?: string;
  type: KnowledgeType;
  title: string;
  summary: string;
  content?: string;
  para?: ParaRef;
  tags?: string[];
  source?: KnowledgeSource;
  createdBy?: MemberIdentity;
  createdAt?: string;
  visibility?: KnowledgeVisibility;
  confidence?: number;
  weight?: number;
}

export interface KnowledgeFilter {
  layers?: KnowledgeLayer[];
  types?: KnowledgeType[];
  para?: Partial<ParaRef>;
  authorName?: string | null;
  tags?: string[];
  includeSuperseded?: boolean;
  recencyDays?: number;
}

export interface SearchKnowledgeInput extends KnowledgeFilter {
  query: string;
  limit?: number;
}

export interface RateKnowledgeInput {
  id: string;
  rating?: number;
  adoptionDelta?: number;
  confidenceDelta?: number;
  weightDelta?: number;
}

export interface KnowledgeRepository {
  upsert(item: KnowledgeItem): Promise<void>;
  get(id: string): Promise<KnowledgeItem | undefined>;
  list(filter?: KnowledgeFilter): Promise<KnowledgeItem[]>;
  search(input: SearchKnowledgeInput): Promise<KnowledgeItem[]>;
}

export interface DevMeshCoreOptions {
  projectRoot?: string;
  repository?: KnowledgeRepository;
  registry?: ExtensionRegistry;
}

export interface DevMeshCore {
  projectRoot: string;
  registry?: ExtensionRegistry;
  repository: KnowledgeRepository;
  captureKnowledge(input: CaptureKnowledgeInput): Promise<KnowledgeItem>;
  getKnowledge(id: string): Promise<KnowledgeItem | undefined>;
  listKnowledge(filter?: KnowledgeFilter): Promise<KnowledgeItem[]>;
  searchKnowledge(input: SearchKnowledgeInput): Promise<KnowledgeItem[]>;
  rateKnowledge(input: RateKnowledgeInput): Promise<KnowledgeItem>;
}

export class InMemoryKnowledgeRepository implements KnowledgeRepository {
  private readonly items = new Map<string, KnowledgeItem>();

  async upsert(item: KnowledgeItem): Promise<void> {
    this.items.set(item.id, item);
  }

  async get(id: string): Promise<KnowledgeItem | undefined> {
    return this.items.get(id);
  }

  async list(filter: KnowledgeFilter = {}): Promise<KnowledgeItem[]> {
    return [...this.items.values()]
      .filter((item) => matchesKnowledgeFilter(item, filter))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async search(input: SearchKnowledgeInput): Promise<KnowledgeItem[]> {
    return [...this.items.values()]
      .filter((item) => matchesKnowledgeFilter(item, input))
      .map((item) => ({
        item,
        score: rankKnowledgeItem(item, input)
      }))
      .filter((candidate) => candidate.score > 0 || input.query.trim().length === 0)
      .sort((a, b) => b.score - a.score || b.item.updatedAt.localeCompare(a.item.updatedAt))
      .slice(0, input.limit ?? 8)
      .map((candidate) => candidate.item);
  }
}

export function createDevMeshCore(options: DevMeshCoreOptions = {}): DevMeshCore {
  const repository = options.repository ?? new InMemoryKnowledgeRepository();
  const projectRoot = options.projectRoot ?? process.cwd();

  const core: DevMeshCore = {
    projectRoot,
    repository,
    async captureKnowledge(input) {
      const item = createKnowledgeItem(input);
      await repository.upsert(item);
      return item;
    },
    getKnowledge: (id) => repository.get(id),
    listKnowledge: (filter) => repository.list(filter),
    searchKnowledge: (input) => repository.search(input),
    async rateKnowledge(input) {
      const existing = await repository.get(input.id);
      invariant(existing, 'knowledge.not_found', `Knowledge item ${input.id} was not found`);

      const quality: QualitySignals = {
        ...existing.quality,
        rating: input.rating === undefined ? existing.quality.rating : clamp01(input.rating),
        adoptionScore: clamp01(existing.quality.adoptionScore + (input.adoptionDelta ?? 0)),
        confidence: clamp01(existing.quality.confidence + (input.confidenceDelta ?? 0)),
        weight: Math.max(0, existing.quality.weight + (input.weightDelta ?? 0))
      };
      quality.qualityScore = computeQualityScore(quality);

      const updated: KnowledgeItem = {
        ...existing,
        quality,
        updatedAt: nowIso()
      };
      await repository.upsert(updated);
      return updated;
    }
  };

  if (options.registry !== undefined) {
    core.registry = options.registry;
  }

  return core;
}

export function createKnowledgeItem(input: CaptureKnowledgeInput): KnowledgeItem {
  const createdAt = input.createdAt ?? nowIso();
  const layer = input.layer ?? 'extract';
  const para = input.para ?? inferParaRef(input.type);
  const quality = createQualitySignals({
    confidence: input.confidence ?? defaultConfidence(layer),
    weight: input.weight ?? 1
  });
  const id = input.id ?? createKnowledgeId(layer === 'canonical' ? 'can' : layer === 'raw' ? 'raw' : 'ki');

  const item: KnowledgeItem = {
    id,
    layer,
    entryKey: input.entryKey ?? createEntryKey(para, input.title),
    type: input.type,
    title: input.title,
    summary: input.summary,
    para,
    tags: [...new Set(input.tags ?? [])],
    source: input.source ?? { kind: 'manual' },
    createdBy: input.createdBy ?? { displayName: 'local' },
    createdAt,
    updatedAt: createdAt,
    visibility: input.visibility ?? 'project',
    status: 'active',
    quality
  };

  if (input.content !== undefined) {
    item.content = input.content;
  }

  return item;
}

export function createQualitySignals(input: Partial<QualitySignals> = {}): QualitySignals {
  const quality: QualitySignals = {
    confidence: clamp01(input.confidence ?? 0.5),
    weight: Math.max(0, input.weight ?? 1),
    rating: clamp01(input.rating ?? 0.5),
    adoptionScore: clamp01(input.adoptionScore ?? 0),
    sourceTrust: clamp01(input.sourceTrust ?? 0.5),
    evidence: clamp01(input.evidence ?? 0.3),
    freshness: clamp01(input.freshness ?? 1),
    qualityScore: 0
  };
  quality.qualityScore = computeQualityScore(quality);
  return quality;
}

export function computeQualityScore(quality: Omit<QualitySignals, 'qualityScore'> | QualitySignals): number {
  return clamp01(
    quality.confidence * 0.28 +
      quality.rating * 0.2 +
      quality.adoptionScore * 0.22 +
      quality.sourceTrust * 0.12 +
      quality.evidence * 0.1 +
      quality.freshness * 0.08
  );
}

export function matchesKnowledgeFilter(item: KnowledgeItem, filter: KnowledgeFilter = {}): boolean {
  if (!filter.includeSuperseded && item.status !== 'active') {
    return false;
  }

  if (filter.layers?.length && !filter.layers.includes(item.layer)) {
    return false;
  }

  if (filter.types?.length && !filter.types.includes(item.type)) {
    return false;
  }

  if (filter.para?.category && filter.para.category !== item.para.category) {
    return false;
  }

  if (filter.para?.key && !item.para.key.startsWith(filter.para.key)) {
    return false;
  }

  if (filter.authorName && !matchesAuthor(item.createdBy, filter.authorName)) {
    return false;
  }

  if (filter.tags?.length && !filter.tags.every((tag) => item.tags.includes(tag))) {
    return false;
  }

  if (filter.recencyDays !== undefined) {
    const updatedAt = Date.parse(item.updatedAt);
    const maxAgeMs = filter.recencyDays * 24 * 60 * 60 * 1000;

    if (!Number.isNaN(updatedAt) && Date.now() - updatedAt > maxAgeMs) {
      return false;
    }
  }

  return true;
}

export function rankKnowledgeItem(item: KnowledgeItem, input: SearchKnowledgeInput): number {
  const terms = tokenize(input.query);
  const textScore =
    scoreText(item.title, terms) * 0.35 +
    scoreText(item.summary, terms) * 0.3 +
    scoreText(item.content ?? '', terms) * 0.15 +
    scoreText(item.entryKey, terms) * 0.1 +
    scoreText(item.tags.join(' '), terms) * 0.1;
  const recencyScore = recencyBoost(item.updatedAt);
  const baseRelevance = textScore * 0.75 + recencyScore * 0.25;
  const finalScore = baseRelevance * 0.7 + item.quality.qualityScore * 0.2 + item.quality.adoptionScore * 0.1;

  return finalScore * item.quality.weight;
}

export function createKnowledgeId(prefix = 'ki'): string {
  return `${prefix}_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
}

function defaultConfidence(layer: KnowledgeLayer): number {
  if (layer === 'canonical') {
    return 0.8;
  }

  if (layer === 'raw') {
    return 0.35;
  }

  return 0.55;
}

function inferParaRef(type: KnowledgeType): ParaRef {
  if (type === 'task') {
    return { category: 'projects', key: 'current' };
  }

  if (type === 'command' || type === 'runbook') {
    return { category: 'resources', key: 'developer-workflow' };
  }

  return { category: 'areas', key: 'general' };
}

function createEntryKey(para: ParaRef, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return `${para.category}/${para.key}/${slug || 'untitled'}`;
}

function matchesAuthor(author: MemberIdentity, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  return [author.displayName, author.handle, author.memberId]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(normalized));
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function scoreText(text: string, terms: string[]): number {
  if (terms.length === 0) {
    return 1;
  }

  const normalized = text.toLowerCase();
  const hits = terms.reduce((count, term) => count + (normalized.includes(term) ? 1 : 0), 0);
  return hits / terms.length;
}

function recencyBoost(value: string): number {
  const updatedAt = Date.parse(value);

  if (Number.isNaN(updatedAt)) {
    return 0;
  }

  const ageDays = Math.max(0, (Date.now() - updatedAt) / (24 * 60 * 60 * 1000));
  return clamp01(1 - ageDays / 180);
}
