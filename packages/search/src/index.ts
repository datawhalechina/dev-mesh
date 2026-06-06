import type { IndexInput, SearchBackend, SearchCandidate, SearchInput } from '@mcp-dev-mesh/extension-api';

interface IndexedDocument {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
}

interface IndexedHybridDocument extends IndexedDocument {
  embedding: number[];
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

export interface HybridSearchBackendOptions {
  embeddingProvider?: EmbeddingProvider;
  now?: () => Date;
}

export function createKeywordSearchBackend(): SearchBackend {
  const documents = new Map<string, IndexedDocument>();

  return {
    id: 'dev-mesh.search.keyword',
    kind: 'search-backend',
    capabilities: ['search.keyword'],
    priority: 10,
    async index(input: IndexInput) {
      for (const document of input.documents) {
        documents.set(document.id, document);
      }
    },
    async remove(input) {
      for (const id of input.ids) {
        documents.delete(id);
      }
    },
    async search(input: SearchInput): Promise<SearchCandidate[]> {
      const terms = tokenize(input.query);
      const limit = input.limit ?? 8;

      return [...documents.values()]
        .filter((document) => matchesFilters(document, input.filters))
        .map((document) => toCandidate(document, keywordScore(document.text, terms)))
        .filter((candidate) => candidate.score > 0 || terms.length === 0)
        .sort(compareCandidates)
        .slice(0, limit);
    }
  };
}

export function createHybridSearchBackend(options: HybridSearchBackendOptions = {}): SearchBackend {
  const embeddingProvider = options.embeddingProvider ?? createDeterministicEmbeddingProvider();
  const documents = new Map<string, IndexedHybridDocument>();

  return {
    id: 'dev-mesh.search.hybrid',
    kind: 'search-backend',
    capabilities: ['search.hybrid', 'search.keyword', 'search.vector', 'search.member-experience'],
    priority: 30,
    async index(input: IndexInput) {
      for (const document of input.documents) {
        documents.set(document.id, {
          ...document,
          embedding: await embeddingProvider.embed(document.text)
        });
      }
    },
    async remove(input) {
      for (const id of input.ids) {
        documents.delete(id);
      }
    },
    async search(input: SearchInput): Promise<SearchCandidate[]> {
      const terms = tokenize(input.query);
      const queryEmbedding = await embeddingProvider.embed(input.query);
      const limit = input.limit ?? 8;

      return [...documents.values()]
        .filter((document) => matchesFilters(document, input.filters))
        .map((document) => {
          const vectorScore = cosineSimilarity(queryEmbedding, document.embedding);
          const bm25Score = keywordScore(document.text, terms);
          const recencyScore = readRecencyScore(document.metadata, options.now?.() ?? new Date());
          const qualityScore = readQualityScore(document.metadata);
          const usageFeedbackScore = readNumberFromMetadata(document.metadata, ['adoptionScore', 'quality.adoptionScore']) ?? 0.5;
          const weight = readNumberFromMetadata(document.metadata, ['weight', 'quality.weight']) ?? 1;
          const baseRelevance = vectorScore * 0.4 + bm25Score * 0.25 + recencyScore * 0.1;
          const finalScore = baseRelevance * 0.7 + qualityScore * 0.2 + usageFeedbackScore * 0.1;

          return toCandidate(document, finalScore * Math.max(0, weight), {
            bm25Score,
            qualityScore,
            recencyScore,
            vectorScore
          });
        })
        .filter((candidate) => candidate.score > 0 || terms.length === 0)
        .sort(compareCandidates)
        .slice(0, limit);
    }
  };
}

export function createBuiltInSearchBackends(): SearchBackend[] {
  return [createKeywordSearchBackend(), createHybridSearchBackend()];
}

export function createDeterministicEmbeddingProvider(dimensions = 32): EmbeddingProvider {
  return {
    async embed(text: string) {
      const vector = Array.from({ length: dimensions }, () => 0);
      const terms = tokenize(text);

      for (const term of terms) {
        const index = hashTerm(term, dimensions);

        vector[index] = (vector[index] ?? 0) + 1;
      }

      return normalizeVector(vector);
    }
  };
}

function toCandidate(
  document: IndexedDocument,
  score: number,
  scoreBreakdown?: Record<string, number>
): SearchCandidate {
  const candidate: SearchCandidate = {
    id: document.id,
    score
  };

  if (document.metadata !== undefined || scoreBreakdown !== undefined) {
    candidate.metadata = {
      ...(document.metadata ?? {})
    };

    if (scoreBreakdown !== undefined) {
      candidate.metadata.scoreBreakdown = scoreBreakdown;
    }
  }

  return candidate;
}

function compareCandidates(a: SearchCandidate, b: SearchCandidate): number {
  return b.score - a.score || a.id.localeCompare(b.id);
}

function matchesFilters(document: IndexedDocument, filters: Record<string, unknown> | undefined): boolean {
  if (filters === undefined) {
    return true;
  }

  const metadata = document.metadata ?? {};

  if (!readBoolean(filters.includeSuperseded) && readString(metadata.status) === 'superseded') {
    return false;
  }

  if (!matchesStringFilter(readString(metadata.layer), filters.layer ?? filters.layers)) {
    return false;
  }

  if (!matchesStringFilter(readString(metadata.type), filters.type ?? filters.types)) {
    return false;
  }

  if (!matchesTags(readStringList(metadata.tags), filters.tags)) {
    return false;
  }

  if (!matchesAuthor(metadata, readString(filters.authorName) ?? readString(filters.memberName))) {
    return false;
  }

  const para = readRecord(metadata.para);
  const paraFilter = readRecord(filters.para);
  const paraCategory = readString(filters.paraCategory) ?? readString(paraFilter.category);
  const paraKey = readString(filters.paraKey) ?? readString(paraFilter.key);

  if (paraCategory !== undefined && readString(para.category) !== paraCategory) {
    return false;
  }

  if (paraKey !== undefined && !readString(para.key)?.startsWith(paraKey)) {
    return false;
  }

  return true;
}

function matchesStringFilter(value: string | undefined, filter: unknown): boolean {
  const values = Array.isArray(filter)
    ? filter.filter((item): item is string => typeof item === 'string')
    : typeof filter === 'string'
      ? [filter]
      : [];

  return values.length === 0 || (value !== undefined && values.includes(value));
}

function matchesTags(tags: string[], filter: unknown): boolean {
  if (!Array.isArray(filter)) {
    return true;
  }

  const required = filter.filter((item): item is string => typeof item === 'string');

  return required.every((tag) => tags.includes(tag));
}

function matchesAuthor(metadata: Record<string, unknown>, query: string | undefined): boolean {
  if (query === undefined) {
    return true;
  }

  const normalized = query.trim().toLowerCase();
  const createdBy = readRecord(metadata.createdBy);
  const author = readRecord(metadata.author);
  const candidates = [
    readString(metadata.authorName),
    readString(metadata.memberName),
    readString(createdBy.displayName),
    readString(createdBy.handle),
    readString(createdBy.memberId),
    readString(author.displayName),
    readString(author.handle),
    readString(author.memberId)
  ].filter((value): value is string => value !== undefined);

  return candidates.some((value) => value.toLowerCase().includes(normalized));
}

function keywordScore(text: string, terms: string[]): number {
  if (terms.length === 0) {
    return 1;
  }

  const normalized = text.toLowerCase();
  const hits = terms.reduce((count, term) => count + countOccurrences(normalized, term), 0);

  return Math.min(1, hits / terms.length);
}

function countOccurrences(text: string, term: string): number {
  let count = 0;
  let index = text.indexOf(term);

  while (index !== -1) {
    count += 1;
    index = text.indexOf(term, index + term.length);
  }

  return count;
}

function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;

  for (let index = 0; index < length; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;

    dot += left * right;
    aNorm += left * left;
    bNorm += right * right;
  }

  if (aNorm === 0 || bNorm === 0) {
    return 0;
  }

  return Math.max(0, dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm)));
}

function normalizeVector(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

  if (norm === 0) {
    return vector;
  }

  return vector.map((value) => value / norm);
}

function hashTerm(term: string, modulo: number): number {
  let hash = 0;

  for (const char of term) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return hash % modulo;
}

function readRecencyScore(metadata: Record<string, unknown> | undefined, now: Date): number {
  const updatedAt = readString(metadata?.updatedAt) ?? readString(metadata?.createdAt);
  const timestamp = updatedAt === undefined ? NaN : Date.parse(updatedAt);

  if (Number.isNaN(timestamp)) {
    return 0.4;
  }

  const ageDays = Math.max(0, (now.getTime() - timestamp) / (24 * 60 * 60 * 1000));

  if (ageDays <= 7) {
    return 1;
  }

  if (ageDays <= 30) {
    return 0.85;
  }

  if (ageDays <= 90) {
    return 0.65;
  }

  if (ageDays <= 180) {
    return 0.45;
  }

  return 0.25;
}

function readQualityScore(metadata: Record<string, unknown> | undefined): number {
  return readNumberFromMetadata(metadata, ['qualityScore', 'quality.qualityScore']) ?? 0.5;
}

function readNumberFromMetadata(metadata: Record<string, unknown> | undefined, paths: string[]): number | undefined {
  for (const path of paths) {
    const value = readPath(metadata, path);

    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return undefined;
}

function readPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => readRecord(current)[part], value);
}

function readRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .match(/[\p{L}\p{N}_]+/gu)
    ?.filter(Boolean) ?? [];
}
