import type { Extractor, RawEvent } from '@mcp-dev-mesh/extension-api';

export function createRuleBasedExtractor(): Extractor {
  return {
    id: 'dev-mesh.extractor.rule-based',
    kind: 'extractor',
    capabilities: ['extract.rule-based'],
    priority: 10,
    supports(event: RawEvent) {
      return Boolean(event.summary);
    },
    async extract({ event }) {
      return [
        {
          type: event.kind.includes('command') ? 'command' : 'note',
          title: event.summary.slice(0, 80),
          summary: event.summary,
          confidence: 0.45,
          para: {
            category: 'resources',
            key: 'captured-events'
          },
          tags: [event.kind]
        }
      ];
    }
  };
}

export function createBuiltInExtractors(): Extractor[] {
  return [createRuleBasedExtractor()];
}
