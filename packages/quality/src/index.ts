import type { KnowledgeItemLike, QualityScorer } from '@mcp-dev-mesh/extension-api';

export function createFreshnessScorer(): QualityScorer<KnowledgeItemLike> {
  return {
    id: 'dev-mesh.quality.freshness',
    kind: 'quality-scorer',
    capabilities: ['quality.score.freshness'],
    priority: 20,
    supports() {
      return true;
    },
    async score({ item }) {
      const updatedAt = item.updatedAt ? Date.parse(item.updatedAt) : NaN;

      if (Number.isNaN(updatedAt)) {
        return {
          freshnessDelta: -0.1,
          reasons: ['missing updatedAt timestamp']
        };
      }

      const ageDays = Math.max(0, (Date.now() - updatedAt) / (24 * 60 * 60 * 1000));

      return {
        confidenceDelta: ageDays > 180 ? -0.05 : 0,
        reasons: [`ageDays=${Math.round(ageDays)}`]
      };
    }
  };
}

export function createBuiltInScorers(): QualityScorer[] {
  return [createFreshnessScorer()];
}
