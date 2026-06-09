import type {
  KnowledgeItemLike,
  QualityScoreInput,
  QualityScorePatch,
  QualityScorer
} from '@devmesh/extension-api';

export interface FreshnessScorerOptions {
  now?: () => Date;
}

export type AdoptionSignal =
  | 'accepted_without_change'
  | 'minor_adjustment'
  | 'heavy_rewrite'
  | 'explicit_correction'
  | 'revert_or_test_fail'
  | 'merged_and_reused';

export function createConfidenceScorer(): QualityScorer<KnowledgeItemLike> {
  return {
    id: 'devmesh.quality.confidence',
    kind: 'quality-scorer',
    capabilities: ['quality.score.confidence'],
    priority: 60,
    supports() {
      return true;
    },
    async score(input) {
      const metadata = input.metadata ?? {};
      const current = readQuality(input.item, 'confidence', 0.5);
      const evidence = readNumber(metadata.evidenceCount) ?? readQuality(input.item, 'evidence', 0.3) * 5;
      const testPassed = readBoolean(metadata.testPassed) ?? readBoolean(readRecord(metadata.testResult).passed);
      const risk = readString(metadata.risk);
      const patch = createPatch();

      if (evidence >= 3 && current < 0.85) {
        patch.confidenceDelta = add(patch.confidenceDelta, 0.05);
        patch.reasons.push(`evidenceCount=${Math.round(evidence)}`);
      }

      if (testPassed === true) {
        patch.confidenceDelta = add(patch.confidenceDelta, 0.04);
        patch.reasons.push('tests passed');
      } else if (testPassed === false) {
        patch.confidenceDelta = add(patch.confidenceDelta, -0.08);
        patch.reasons.push('tests failed');
      }

      if (risk === 'high') {
        patch.confidenceDelta = add(patch.confidenceDelta, -0.12);
        patch.reasons.push('high-risk extraction');
      } else if (risk === 'medium') {
        patch.confidenceDelta = add(patch.confidenceDelta, -0.05);
        patch.reasons.push('medium-risk extraction');
      }

      return finalizePatch(patch, 'confidence stable');
    }
  };
}

export function createRatingScorer(): QualityScorer<KnowledgeItemLike> {
  return {
    id: 'devmesh.quality.rating',
    kind: 'quality-scorer',
    capabilities: ['quality.score.rating'],
    priority: 50,
    supports() {
      return true;
    },
    async score({ item, metadata = {} }) {
      const current = readQuality(item, 'rating', 0.5);
      const explicitRating = readNumber(metadata.rating);
      const patch = createPatch();

      if (explicitRating !== undefined) {
        patch.ratingDelta = clamp01(explicitRating) - current;
        patch.reasons.push(`explicit rating=${clamp01(explicitRating).toFixed(2)}`);
      } else if (current >= 0.8) {
        patch.confidenceDelta = 0.03;
        patch.weightDelta = 0.05;
        patch.reasons.push(`high rating=${current.toFixed(2)}`);
      } else if (current <= 0.25) {
        patch.confidenceDelta = -0.05;
        patch.weightDelta = -0.1;
        patch.reasons.push(`low rating=${current.toFixed(2)}`);
      }

      return finalizePatch(patch, 'rating stable');
    }
  };
}

export function createAdoptionScorer(): QualityScorer<KnowledgeItemLike> {
  return {
    id: 'devmesh.quality.adoption',
    kind: 'quality-scorer',
    capabilities: ['quality.score.adoption'],
    priority: 50,
    supports() {
      return true;
    },
    async score({ item, metadata = {} }) {
      const current = readQuality(item, 'adoptionScore', 0);
      const signal = readString(metadata.usageSignal) ?? readString(metadata.eventType);
      const patch = createPatch();

      if (isAdoptionSignal(signal)) {
        applyAdoptionSignal(patch, signal);
      } else if (current >= 0.8) {
        patch.weightDelta = 0.05;
        patch.reasons.push(`high adoptionScore=${current.toFixed(2)}`);
      } else if (current <= 0.25) {
        patch.weightDelta = -0.08;
        patch.reasons.push(`low adoptionScore=${current.toFixed(2)}`);
      }

      return finalizePatch(patch, 'adoption stable');
    }
  };
}

export function createFreshnessScorer(options: FreshnessScorerOptions = {}): QualityScorer<KnowledgeItemLike> {
  return {
    id: 'devmesh.quality.freshness',
    kind: 'quality-scorer',
    capabilities: ['quality.score.freshness'],
    priority: 40,
    supports() {
      return true;
    },
    async score({ item }) {
      const updatedAt = item.updatedAt ? Date.parse(item.updatedAt) : NaN;
      const patch = createPatch();

      if (Number.isNaN(updatedAt)) {
        patch.confidenceDelta = -0.04;
        patch.freshnessDelta = -0.1;
        patch.reasons.push('missing updatedAt timestamp');
        return finalizePatch(patch, 'freshness stable');
      }

      const now = options.now?.() ?? new Date();
      const ageDays = Math.max(0, (now.getTime() - updatedAt) / (24 * 60 * 60 * 1000));

      if (ageDays > 365) {
        patch.confidenceDelta = -0.1;
        patch.weightDelta = -0.1;
        patch.freshnessDelta = -0.25;
      } else if (ageDays > 180) {
        patch.confidenceDelta = -0.05;
        patch.freshnessDelta = -0.15;
      } else if (ageDays > 90) {
        patch.freshnessDelta = -0.05;
      } else if (ageDays <= 14) {
        patch.freshnessDelta = 0.02;
      }

      patch.reasons.push(`ageDays=${Math.round(ageDays)}`);
      return finalizePatch(patch, 'freshness stable');
    }
  };
}

export function createSourceTrustScorer(): QualityScorer<KnowledgeItemLike> {
  return {
    id: 'devmesh.quality.source-trust',
    kind: 'quality-scorer',
    capabilities: ['quality.score.source-trust'],
    priority: 45,
    supports() {
      return true;
    },
    async score(input) {
      const metadata = input.metadata ?? {};
      const sourceKind = readSourceKind(input);
      const reviewed = readBoolean(metadata.reviewed) ?? false;
      const patch = createPatch();

      if (reviewed) {
        patch.sourceTrustDelta = add(patch.sourceTrustDelta, 0.1);
        patch.confidenceDelta = add(patch.confidenceDelta, 0.04);
        patch.reasons.push('human reviewed');
      }

      if (['manual', 'maintainer', 'reviewed', 'server'].includes(sourceKind)) {
        patch.sourceTrustDelta = add(patch.sourceTrustDelta, 0.08);
        patch.reasons.push(`trusted source=${sourceKind}`);
      } else if (['git', 'test', 'mcp-tool', 'local-store'].includes(sourceKind)) {
        patch.sourceTrustDelta = add(patch.sourceTrustDelta, 0.04);
        patch.reasons.push(`structured source=${sourceKind}`);
      } else if (['transcript', 'unknown'].includes(sourceKind)) {
        patch.sourceTrustDelta = add(patch.sourceTrustDelta, -0.04);
        patch.reasons.push(`weak source=${sourceKind}`);
      }

      return finalizePatch(patch, 'source trust stable');
    }
  };
}

export function createBuiltInScorers(options: FreshnessScorerOptions = {}): QualityScorer[] {
  return [
    createConfidenceScorer(),
    createRatingScorer(),
    createAdoptionScorer(),
    createFreshnessScorer(options),
    createSourceTrustScorer()
  ];
}

function applyAdoptionSignal(patch: QualityScorePatch, signal: AdoptionSignal): void {
  switch (signal) {
    case 'accepted_without_change':
      patch.adoptionScoreDelta = 0.08;
      patch.weightDelta = 0.05;
      break;
    case 'minor_adjustment':
      patch.adoptionScoreDelta = 0.03;
      break;
    case 'heavy_rewrite':
      patch.adoptionScoreDelta = -0.12;
      patch.weightDelta = -0.1;
      break;
    case 'explicit_correction':
      patch.adoptionScoreDelta = -0.15;
      patch.confidenceDelta = -0.08;
      break;
    case 'revert_or_test_fail':
      patch.adoptionScoreDelta = -0.18;
      patch.confidenceDelta = -0.1;
      break;
    case 'merged_and_reused':
      patch.adoptionScoreDelta = 0.12;
      patch.confidenceDelta = 0.06;
      break;
  }

  patch.reasons.push(`usageSignal=${signal}`);
}

function readSourceKind(input: QualityScoreInput<KnowledgeItemLike>): string {
  const metadataSource = readString(input.metadata?.sourceKind);
  const itemSource = readString((input.item as KnowledgeItemLike & { source?: { kind?: unknown } }).source?.kind);

  return metadataSource ?? itemSource ?? 'unknown';
}

function createPatch(): QualityScorePatch {
  return {
    reasons: []
  };
}

function finalizePatch(patch: QualityScorePatch, fallbackReason: string): QualityScorePatch {
  if (patch.reasons.length === 0) {
    patch.reasons.push(fallbackReason);
  }

  return patch;
}

function add(current: number | undefined, delta: number): number {
  return (current ?? 0) + delta;
}

function readQuality(item: KnowledgeItemLike, key: string, fallback: number): number {
  const value = item.quality?.[key];

  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
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

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function isAdoptionSignal(value: string | undefined): value is AdoptionSignal {
  return (
    value === 'accepted_without_change' ||
    value === 'minor_adjustment' ||
    value === 'heavy_rewrite' ||
    value === 'explicit_correction' ||
    value === 'revert_or_test_fail' ||
    value === 'merged_and_reused'
  );
}
