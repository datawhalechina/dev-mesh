import { describe, expect, it } from 'vitest';
import {
  createBuiltInSearchBackends,
  createDeterministicEmbeddingProvider,
  createHybridSearchBackend,
  createKeywordSearchBackend
} from '../src/index.js';

describe('search backends', () => {
  it('filters member-specific experience by author metadata', async () => {
    const backend = createKeywordSearchBackend();

    await backend.index({
      documents: [
        {
          id: 'xiaoyun-auth',
          text: 'Auth session refresh pitfall',
          metadata: {
            authorName: 'Xiaoyun',
            createdBy: {
              handle: 'xiaoyun'
            }
          }
        },
        {
          id: 'ayuan-auth',
          text: 'Auth session refresh pitfall',
          metadata: {
            authorName: 'Ayuan',
            createdBy: {
              handle: 'ayuan'
            }
          }
        }
      ]
    });

    await expect(
      backend.search({
        query: 'auth refresh',
        filters: {
          authorName: 'xiao'
        }
      })
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'xiaoyun-auth'
      })
    ]);
  });

  it('combines deterministic embeddings, keyword hits, recency, and quality metadata', async () => {
    const backend = createHybridSearchBackend({
      embeddingProvider: createDeterministicEmbeddingProvider(),
      now: () => new Date('2026-06-06T00:00:00.000Z')
    });

    await backend.index({
      documents: [
        {
          id: 'low-quality-direct-hit',
          text: 'login session refresh',
          metadata: {
            qualityScore: 0.1,
            adoptionScore: 0.1,
            weight: 0.5,
            updatedAt: '2026-06-01T00:00:00.000Z'
          }
        },
        {
          id: 'high-quality-direct-hit',
          text: 'login session refresh',
          metadata: {
            qualityScore: 0.95,
            adoptionScore: 0.9,
            weight: 1.5,
            updatedAt: '2026-06-05T00:00:00.000Z'
          }
        },
        {
          id: 'unrelated',
          text: 'deploy cache cleanup',
          metadata: {
            qualityScore: 0.6,
            adoptionScore: 0.6,
            weight: 1,
            updatedAt: '2026-06-05T00:00:00.000Z'
          }
        }
      ]
    });

    const results = await backend.search({
      query: 'login refresh',
      limit: 3
    });

    expect(results.map((result) => result.id)).toEqual([
      'high-quality-direct-hit',
      'low-quality-direct-hit',
      'unrelated'
    ]);
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 0);
    expect(results[0]?.metadata?.scoreBreakdown).toMatchObject({
      bm25Score: expect.any(Number),
      qualityScore: 0.95,
      recencyScore: 1,
      vectorScore: expect.any(Number)
    });
  });

  it('exposes keyword and hybrid backends as built-ins', () => {
    expect(createBuiltInSearchBackends().map((backend) => backend.id)).toEqual([
      'dev-mesh.search.keyword',
      'dev-mesh.search.hybrid'
    ]);
  });
});
