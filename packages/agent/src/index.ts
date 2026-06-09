import type {
  DevMeshCore,
  KnowledgeItem,
  KnowledgeLayer,
  KnowledgeType,
  ParaRef,
  SearchKnowledgeInput
} from '@devmesh/core';

export interface BuildContextPackInput {
  query: string;
  para?: Partial<ParaRef>;
  layers?: KnowledgeLayer[];
  types?: KnowledgeType[];
  authorName?: string | null;
  limit?: number;
  recencyDays?: number;
  includeSuperseded?: boolean;
  maxContentChars?: number;
}

export interface ContextPackItem {
  id: string;
  title: string;
  summary: string;
  content?: string;
  type: KnowledgeType;
  layer: KnowledgeLayer;
  entryKey: string;
  para: ParaRef;
  tags: string[];
  source: {
    kind: string;
    ref?: string;
    storageRef?: string;
  };
  quality: {
    confidence: number;
    weight: number;
    rating: number;
    adoptionScore: number;
    qualityScore: number;
  };
  createdBy: {
    displayName: string;
    handle?: string;
  };
  updatedAt: string;
}

export interface ContextPack {
  query: string;
  generatedAt: string;
  items: ContextPackItem[];
}

export interface AgentContextService {
  buildContextPack(input: BuildContextPackInput): Promise<ContextPack>;
}

export interface AgentContextServiceOptions {
  core: DevMeshCore;
}

export function createAgentContextService(options: AgentContextServiceOptions): AgentContextService {
  return {
    async buildContextPack(input) {
      const searchInput: SearchKnowledgeInput = {
        query: input.query,
        layers: input.layers ?? ['canonical', 'extract'],
        limit: input.limit ?? 8
      };

      if (input.para !== undefined) {
        searchInput.para = input.para;
      }

      if (input.types !== undefined) {
        searchInput.types = input.types;
      }

      if (input.authorName !== undefined) {
        searchInput.authorName = input.authorName;
      }

      if (input.recencyDays !== undefined) {
        searchInput.recencyDays = input.recencyDays;
      }

      if (input.includeSuperseded !== undefined) {
        searchInput.includeSuperseded = input.includeSuperseded;
      }

      const items = await options.core.searchKnowledge(searchInput);

      return {
        query: input.query,
        generatedAt: new Date().toISOString(),
        items: items.map((item) => toContextPackItem(item, input.maxContentChars ?? 1200))
      };
    }
  };
}

function toContextPackItem(item: KnowledgeItem, maxContentChars: number): ContextPackItem {
  const result: ContextPackItem = {
    id: item.id,
    title: item.title,
    summary: item.summary,
    type: item.type,
    layer: item.layer,
    entryKey: item.entryKey,
    para: item.para,
    tags: item.tags,
    source: {
      kind: item.source.kind
    },
    quality: {
      confidence: item.quality.confidence,
      weight: item.quality.weight,
      rating: item.quality.rating,
      adoptionScore: item.quality.adoptionScore,
      qualityScore: item.quality.qualityScore
    },
    createdBy: {
      displayName: item.createdBy.displayName
    },
    updatedAt: item.updatedAt
  };

  if (item.content) {
    result.content = truncate(item.content, maxContentChars);
  }

  if (item.source.ref !== undefined) {
    result.source.ref = item.source.ref;
  }

  if (item.source.storageRef !== undefined) {
    result.source.storageRef = item.source.storageRef;
  }

  if (item.createdBy.handle !== undefined) {
    result.createdBy.handle = item.createdBy.handle;
  }

  return result;
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}
