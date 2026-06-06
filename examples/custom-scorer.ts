import type { DevMeshExtension, ExtensionRegistry, QualityScorer } from '@mcp-dev-mesh/extension-api';

const domainFreshnessScorer: QualityScorer = {
  id: 'company.domain-freshness-scorer',
  kind: 'quality-scorer',
  capabilities: ['quality.score.freshness'],
  priority: 100,
  supports: (item) => item.para?.category === 'areas',
  async score({ item }) {
    const updatedAt = item.updatedAt ? Date.parse(item.updatedAt) : 0;
    const stale = updatedAt < Date.parse('2026-01-01');

    return {
      confidenceDelta: stale ? -0.1 : 0,
      reasons: ['company domain freshness policy']
    };
  }
};

export const domainFreshnessExtension: DevMeshExtension = {
  id: 'company.quality.domain-freshness',
  version: '0.1.0',
  kind: 'quality-scorer',
  capabilities: ['quality.score.freshness'],
  priority: 100,
  register(registry: ExtensionRegistry) {
    registry.registerScorer(domainFreshnessScorer);
  }
};
