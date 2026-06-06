import type { IndexInput, SearchBackend, SearchCandidate, SearchInput } from '@mcp-dev-mesh/extension-api';

interface IndexedDocument {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
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
      const terms = input.query.toLowerCase().split(/\s+/).filter(Boolean);
      const limit = input.limit ?? 8;

      return [...documents.values()]
        .map((document) => {
          const candidate: SearchCandidate = {
            id: document.id,
            score: score(document.text, terms)
          };

          if (document.metadata !== undefined) {
            candidate.metadata = document.metadata;
          }

          return candidate;
        })
        .filter((candidate) => candidate.score > 0 || terms.length === 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    }
  };
}

function score(text: string, terms: string[]): number {
  if (terms.length === 0) {
    return 1;
  }

  const normalized = text.toLowerCase();
  return terms.reduce((hits, term) => hits + (normalized.includes(term) ? 1 : 0), 0) / terms.length;
}
