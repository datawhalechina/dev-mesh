import type { Extractor, RawEvent, RedactionFinding, RedactionInput, RedactionResult, Redactor } from '@mcp-dev-mesh/extension-api';

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

export function createSecretRedactor(): Redactor {
  return {
    id: 'dev-mesh.redactor.secrets',
    kind: 'redactor',
    capabilities: ['redact.secret', 'redact.credential', 'redact.sensitive-path'],
    priority: 100,
    async scan(input: RedactionInput) {
      return scanText(input.text);
    },
    async redact(input: RedactionInput) {
      const findings = scanText(input.text);
      return {
        text: redactFindings(input.text, findings),
        findings
      };
    }
  };
}

export function createBuiltInRedactors(): Redactor[] {
  return [createSecretRedactor()];
}

export function scanText(text: string): RedactionFinding[] {
  const findings: RedactionFinding[] = [];

  for (const rule of REDACTION_RULES) {
    const regex = new RegExp(rule.regex.source, rule.regex.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const value = rule.secretGroup === undefined ? match[0] : match[rule.secretGroup];

      if (!value) {
        continue;
      }

      const start = match.index + match[0].indexOf(value);
      const finding: RedactionFinding = {
        kind: rule.kind,
        start,
        end: start + value.length,
        severity: rule.severity
      };

      if (rule.label !== undefined) {
        finding.label = rule.label;
      }

      findings.push(finding);

      if (match[0].length === 0) {
        regex.lastIndex += 1;
      }
    }
  }

  return mergeFindings(findings);
}

export function redactText(text: string): RedactionResult {
  const findings = scanText(text);
  return {
    text: redactFindings(text, findings),
    findings
  };
}

interface RedactionRule {
  regex: RegExp;
  kind: string;
  severity: 'low' | 'medium' | 'high';
  label: string;
  secretGroup?: number;
}

const REDACTION_RULES: RedactionRule[] = [
  {
    regex: /\b(Authorization\s*:\s*(?:Bearer|Basic)\s+)([A-Za-z0-9._~+/=-]+)/gi,
    kind: 'credential',
    severity: 'high',
    label: 'authorization',
    secretGroup: 2
  },
  {
    regex: /\b(Cookie\s*:\s*)([^\r\n]+)/gi,
    kind: 'credential',
    severity: 'high',
    label: 'cookie',
    secretGroup: 2
  },
  {
    regex: /([?&](?:access_token|api_key|token|secret|signature|sig|password)=)([^&\s"'<>]+)/gi,
    kind: 'secret',
    severity: 'high',
    label: 'url-token',
    secretGroup: 2
  },
  {
    regex: /(?:^|[^?&A-Z0-9_])([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*=\s*)([^\s"'`]+)/gi,
    kind: 'secret',
    severity: 'high',
    label: 'env-secret',
    secretGroup: 2
  },
  {
    regex: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    kind: 'credential',
    severity: 'high',
    label: 'private-key'
  },
  {
    regex: /(?:^|[\s"'(])((?:[A-Za-z]:)?[^"'()\s]*\.env(?:\.[^"'()\s]*)?|(?:[A-Za-z]:)?[^"'()\s]+\.(?:pem|key))(?![A-Za-z0-9_.-])/gi,
    kind: 'credential',
    severity: 'high',
    label: 'sensitive-path',
    secretGroup: 1
  }
];

function mergeFindings(findings: RedactionFinding[]): RedactionFinding[] {
  return findings
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .reduce<RedactionFinding[]>((merged, finding) => {
      const previous = merged.at(-1);

      if (!previous || finding.start >= previous.end) {
        merged.push(finding);
        return merged;
      }

      if (finding.end > previous.end) {
        previous.end = finding.end;
      }

      if (severityRank(finding.severity) > severityRank(previous.severity)) {
        previous.severity = finding.severity;
      }

      if (previous.label === undefined && finding.label !== undefined) {
        previous.label = finding.label;
      }

      return merged;
    }, []);
}

function redactFindings(text: string, findings: RedactionFinding[]): string {
  let cursor = 0;
  let output = '';

  for (const finding of findings) {
    output += text.slice(cursor, finding.start);
    output += `[REDACTED:${finding.label ?? finding.kind}]`;
    cursor = finding.end;
  }

  output += text.slice(cursor);
  return output;
}

function severityRank(severity: RedactionFinding['severity']): number {
  if (severity === 'high') {
    return 3;
  }

  if (severity === 'medium') {
    return 2;
  }

  return 1;
}
