import type { KnowledgeItemLike } from '@devmesh/extension-api';
import { describe, expect, it } from 'vitest';
import {
  createAdoptionScorer,
  createBuiltInScorers,
  createConfidenceScorer,
  createFreshnessScorer,
  createRatingScorer,
  createSourceTrustScorer
} from '../src/index.js';

describe('built-in quality scorers', () => {
  it('registers confidence, rating, adoption, freshness, and source trust scorers', () => {
    const scorers = createBuiltInScorers();

    expect(scorers.map((scorer) => scorer.id)).toEqual([
      'devmesh.quality.confidence',
      'devmesh.quality.rating',
      'devmesh.quality.adoption',
      'devmesh.quality.freshness',
      'devmesh.quality.source-trust'
    ]);
    expect(scorers.flatMap((scorer) => scorer.capabilities)).toEqual([
      'quality.score.confidence',
      'quality.score.rating',
      'quality.score.adoption',
      'quality.score.freshness',
      'quality.score.source-trust'
    ]);
  });

  it('scores confidence from evidence, test results, and extraction risk', async () => {
    const scorer = createConfidenceScorer();
    const patch = await scorer.score({
      item: item({ confidence: 0.6, evidence: 0.8 }),
      metadata: {
        evidenceCount: 4,
        risk: 'medium',
        testPassed: true
      }
    });

    expect(patch.confidenceDelta).toBeCloseTo(0.04);
    expect(patch.reasons).toEqual(['evidenceCount=4', 'tests passed', 'medium-risk extraction']);
  });

  it('scores explicit ratings and adoption feedback', async () => {
    const ratingPatch = await createRatingScorer().score({
      item: item({ rating: 0.4 }),
      metadata: {
        rating: 0.9
      }
    });
    const adoptionPatch = await createAdoptionScorer().score({
      item: item({ adoptionScore: 0.6 }),
      metadata: {
        usageSignal: 'heavy_rewrite'
      }
    });

    expect(ratingPatch).toMatchObject({
      ratingDelta: 0.5,
      reasons: ['explicit rating=0.90']
    });
    expect(adoptionPatch).toMatchObject({
      adoptionScoreDelta: -0.12,
      weightDelta: -0.1,
      reasons: ['usageSignal=heavy_rewrite']
    });
  });

  it('scores stale knowledge freshness with a fixed clock', async () => {
    const scorer = createFreshnessScorer({
      now: () => new Date('2026-06-06T00:00:00.000Z')
    });
    const patch = await scorer.score({
      item: item({}, '2025-10-01T00:00:00.000Z')
    });

    expect(patch).toMatchObject({
      confidenceDelta: -0.05,
      freshnessDelta: -0.15,
      reasons: ['ageDays=248']
    });
  });

  it('scores source trust from source kind and human review metadata', async () => {
    const scorer = createSourceTrustScorer();
    const patch = await scorer.score({
      item: {
        ...item(),
        source: {
          kind: 'git'
        }
      } as KnowledgeItemLike,
      metadata: {
        reviewed: true
      }
    });

    expect(patch).toMatchObject({
      confidenceDelta: 0.04,
      sourceTrustDelta: 0.14,
      reasons: ['human reviewed', 'structured source=git']
    });
  });
});

function item(quality: Record<string, number> = {}, updatedAt = '2026-06-06T00:00:00.000Z'): KnowledgeItemLike {
  return {
    id: 'ki_test',
    quality,
    updatedAt
  };
}
