import type {
  Extractor,
  ExtractProposal,
  RawEvent,
  RedactionFinding,
  RedactionInput,
  RedactionResult,
  Redactor
} from '@mcp-dev-mesh/extension-api';

type ExtractRisk = 'low' | 'medium' | 'high';

export function createRuleBasedExtractor(): Extractor {
  return {
    id: 'dev-mesh.extractor.rule-based',
    kind: 'extractor',
    capabilities: ['extract.rule-based'],
    priority: 10,
    supports(event: RawEvent) {
      return Boolean(event.summary) || ['git.snapshot', 'filesystem.snapshot', 'mcp.tool_call'].includes(event.kind);
    },
    async extract({ event }) {
      const proposals =
        event.kind === 'git.snapshot'
          ? extractGitSnapshot(event)
          : event.kind === 'filesystem.snapshot'
            ? extractFileSystemSnapshot(event)
            : event.kind === 'mcp.tool_call'
              ? extractMcpToolCall(event)
              : [fallbackProposal(event)];

      return dedupeProposals(proposals);
    }
  };
}

export function createBuiltInExtractors(): Extractor[] {
  return [createRuleBasedExtractor()];
}

function extractGitSnapshot(event: RawEvent): ExtractProposal[] {
  const payload = readRecord(event.payload);
  const changedFiles = readChangedFiles(payload.changedFiles);
  const issueKeys = readStringList(payload.issueKeys);
  const branch = readString(payload.branch);
  const headCommit = readString(payload.headCommit);
  const headSubject = readString(payload.headSubject);
  const testResult = readRecord(payload.testResult);
  const testCommand = readString(testResult.command);
  const testPassed = readBoolean(testResult.passed);
  const projectKey = issueKeys[0] ?? toParaKey(branch ?? 'git-snapshot');
  const summaryParts = [
    event.summary,
    summarizeChangedFiles(changedFiles),
    summarizeIssueKeys(issueKeys),
    summarizeTestResult(testResult)
  ].filter(isNonEmptyString);
  const proposals: ExtractProposal[] = [
    withEventMetadata(
      {
        type: 'task_progress',
        title: issueKeys[0] ? `${issueKeys[0]} git progress` : `Git progress on ${branch ?? 'current branch'}`,
        summary: summaryParts.join(' '),
        confidence: testPassed === false ? 0.62 : testPassed === true ? 0.72 : 0.56,
        para: {
          category: 'projects',
          key: projectKey
        },
        tags: ['git.snapshot', 'git', 'task-progress', ...issueKeys],
        metadata: {
          dedupeKey: `git:${headCommit ?? branch ?? event.id}:${changedFiles.map((file) => file.path).join(',')}`
        }
      },
      event,
      testPassed === false ? 'medium' : 'low',
      {
        branch,
        headCommit,
        headSubject,
        issueKeys,
        changedFileCount: changedFiles.length,
        changedFiles: changedFiles.slice(0, 20)
      }
    )
  ];

  if (testCommand !== undefined) {
    proposals.push(
      withEventMetadata(
        {
          type: 'command',
          title: `Test command ${testPassed === false ? 'failed' : 'passed'}: ${testCommand}`,
          summary: summarizeTestResult(testResult) ?? `Test command observed: ${testCommand}.`,
          confidence: testPassed === false ? 0.64 : 0.74,
          para: {
            category: 'resources',
            key: 'test-commands'
          },
          tags: ['git.snapshot', 'command', 'test-command', testPassed === false ? 'test-failure' : 'test-pass'],
          metadata: {
            dedupeKey: `git-test:${testCommand}:${testPassed ?? 'unknown'}`
          }
        },
        event,
        testPassed === false ? 'medium' : 'low',
        {
          testResult
        }
      )
    );
  }

  return proposals;
}

function extractFileSystemSnapshot(event: RawEvent): ExtractProposal[] {
  const payload = readRecord(event.payload);
  const files = readFileEvents(payload.files);
  const markers = countFileMarkers(files);
  const ignored = readRecord(payload.ignored);
  const truncated = readBoolean(payload.truncated) ?? false;
  const areaKey = inferAreaKey(files);
  const proposals: ExtractProposal[] = [
    withEventMetadata(
      {
        type: 'task_progress',
        title: `Workspace file activity in ${areaKey}`,
        summary: [event.summary, summarizeFileCategories(files), summarizeFilePaths(files)].filter(isNonEmptyString).join(' '),
        confidence: truncated ? 0.5 : 0.58,
        para: {
          category: 'areas',
          key: areaKey
        },
        tags: ['filesystem.snapshot', 'filesystem', 'workspace-activity', ...listTouchedCategories(files)],
        metadata: {
          dedupeKey: `fs:${areaKey}:${files.map((file) => file.path).join(',')}`
        }
      },
      event,
      truncated ? 'medium' : 'low',
      {
        fileCount: files.length,
        files: files.slice(0, 30),
        ignored,
        truncated
      }
    )
  ];

  if (markers.todo + markers.fixme > 0) {
    proposals.push(
      withEventMetadata(
        {
          type: 'task_progress',
          title: 'TODO/FIXME markers changed in workspace',
          summary: `Observed ${markers.todo} TODO and ${markers.fixme} FIXME markers in ${markers.files.length} changed files: ${markers.files.join(', ')}.`,
          confidence: 0.6,
          para: {
            category: 'projects',
            key: 'active-task'
          },
          tags: ['filesystem.snapshot', 'todo', 'fixme', 'task-progress'],
          metadata: {
            dedupeKey: `fs-markers:${markers.files.join(',')}`
          }
        },
        event,
        'medium',
        markers
      )
    );
  }

  return proposals;
}

function extractMcpToolCall(event: RawEvent): ExtractProposal[] {
  const payload = readRecord(event.payload);
  const toolName = readString(payload.toolName) ?? 'unknown-tool';
  const failed = readBoolean(payload.failed) ?? readString(payload.status) === 'failed';
  const error = readRecord(payload.error);
  const errorMessage = readString(error.message);

  return [
    withEventMetadata(
      {
        type: failed ? 'pitfall' : 'command',
        title: `MCP tool ${toolName} ${failed ? 'failed' : 'succeeded'}`,
        summary: errorMessage === undefined ? event.summary : `${event.summary} Error: ${errorMessage}`,
        confidence: failed ? 0.68 : 0.52,
        para: {
          category: 'resources',
          key: 'mcp-tools'
        },
        tags: ['mcp.tool_call', 'mcp-tool', toolName, failed ? 'tool-failure' : 'tool-success'],
        metadata: {
          dedupeKey: `mcp-tool:${toolName}:${failed ? 'failed' : 'succeeded'}:${errorMessage ?? ''}`
        }
      },
      event,
      failed ? 'medium' : 'low',
      {
        toolName,
        failed,
        argumentKeys: readStringList(payload.argumentKeys),
        durationMs: readNumber(payload.durationMs),
        result: readRecord(payload.result),
        error
      }
    )
  ];
}

function fallbackProposal(event: RawEvent): ExtractProposal {
  return withEventMetadata(
    {
      type: event.kind.includes('command') ? 'command' : 'note',
      title: event.summary.slice(0, 80),
      summary: event.summary,
      confidence: 0.45,
      para: {
        category: 'resources',
        key: 'captured-events'
      },
      tags: [event.kind],
      metadata: {
        dedupeKey: `fallback:${event.id}`
      }
    },
    event,
    'medium',
    {
      eventKind: event.kind
    }
  );
}

function withEventMetadata(
  proposal: ExtractProposal,
  event: RawEvent,
  risk: ExtractRisk,
  evidence: Record<string, unknown>
): ExtractProposal {
  return {
    ...proposal,
    metadata: {
      ...proposal.metadata,
      risk,
      sourceEventId: event.id,
      sourceEventKind: event.kind,
      sourceCreatedAt: event.createdAt,
      evidence
    }
  };
}

function dedupeProposals(proposals: ExtractProposal[]): ExtractProposal[] {
  const seen = new Set<string>();
  const deduped: ExtractProposal[] = [];

  for (const proposal of proposals) {
    const dedupeKey = readString(proposal.metadata?.dedupeKey) ?? `${proposal.type}:${proposal.title}:${proposal.summary}`;

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    deduped.push(proposal);
  }

  return deduped;
}

function readRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function readRecordList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(readRecord).filter((item) => Object.keys(item).length > 0);
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

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readChangedFiles(value: unknown): Array<{ additions?: number; deletions?: number; path: string; status?: string }> {
  return readRecordList(value)
    .map((record) => {
      const path = readString(record.path);

      if (path === undefined) {
        return undefined;
      }

      const file: { additions?: number; deletions?: number; path: string; status?: string } = {
        path
      };
      const status = readString(record.status);
      const additions = readNumber(record.additions);
      const deletions = readNumber(record.deletions);

      if (status !== undefined) {
        file.status = status;
      }

      if (additions !== undefined) {
        file.additions = additions;
      }

      if (deletions !== undefined) {
        file.deletions = deletions;
      }

      return file;
    })
    .filter((file): file is { additions?: number; deletions?: number; path: string; status?: string } => file !== undefined);
}

function readFileEvents(
  value: unknown
): Array<{ category?: string; fixme?: number; path: string; todo?: number }> {
  return readRecordList(value)
    .map((record) => {
      const path = readString(record.path);

      if (path === undefined) {
        return undefined;
      }

      const markers = readRecord(record.markers);
      const file: { category?: string; fixme?: number; path: string; todo?: number } = {
        path
      };
      const category = readString(record.category);
      const todo = readNumber(markers.todo);
      const fixme = readNumber(markers.fixme);

      if (category !== undefined) {
        file.category = category;
      }

      if (todo !== undefined) {
        file.todo = todo;
      }

      if (fixme !== undefined) {
        file.fixme = fixme;
      }

      return file;
    })
    .filter((file): file is { category?: string; fixme?: number; path: string; todo?: number } => file !== undefined);
}

function summarizeChangedFiles(files: Array<{ additions?: number; deletions?: number; path: string }>): string | undefined {
  if (files.length === 0) {
    return undefined;
  }

  const additions = files.reduce((sum, file) => sum + (file.additions ?? 0), 0);
  const deletions = files.reduce((sum, file) => sum + (file.deletions ?? 0), 0);
  const stats = additions + deletions > 0 ? ` with +${additions}/-${deletions}` : '';

  return `Changed files${stats}: ${formatPathList(files.map((file) => file.path))}.`;
}

function summarizeIssueKeys(issueKeys: string[]): string | undefined {
  return issueKeys.length > 0 ? `Issue keys: ${issueKeys.join(', ')}.` : undefined;
}

function summarizeTestResult(testResult: Record<string, unknown>): string | undefined {
  const command = readString(testResult.command);
  const passed = readBoolean(testResult.passed);
  const summary = readString(testResult.summary);
  const exitCode = readNumber(testResult.exitCode);

  if (command === undefined && passed === undefined && summary === undefined && exitCode === undefined) {
    return undefined;
  }

  const status = passed === undefined ? 'reported' : passed ? 'passed' : 'failed';
  const commandText = command === undefined ? 'Test command' : `Test command ${command}`;
  const exitText = exitCode === undefined ? '' : ` exit code ${exitCode}.`;
  const summaryText = summary === undefined ? '' : ` ${summary}`;

  return `${commandText} ${status}.${exitText}${summaryText}`.trim();
}

function summarizeFileCategories(files: Array<{ category?: string }>): string | undefined {
  if (files.length === 0) {
    return undefined;
  }

  const counts = new Map<string, number>();

  for (const file of files) {
    const category = file.category ?? 'unknown';
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  return `Categories: ${[...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([category, count]) => `${category}=${count}`)
    .join(', ')}.`;
}

function summarizeFilePaths(files: Array<{ path: string }>): string | undefined {
  return files.length > 0 ? `Files: ${formatPathList(files.map((file) => file.path))}.` : undefined;
}

function formatPathList(paths: string[]): string {
  const visible = paths.slice(0, 8);
  const suffix = paths.length > visible.length ? ` and ${paths.length - visible.length} more` : '';

  return `${visible.join(', ')}${suffix}`;
}

function listTouchedCategories(files: Array<{ category?: string }>): string[] {
  return [...new Set(files.map((file) => file.category).filter((category): category is string => category !== undefined))]
    .sort()
    .map((category) => `category:${category}`);
}

function countFileMarkers(files: Array<{ fixme?: number; path: string; todo?: number }>): {
  files: string[];
  fixme: number;
  todo: number;
} {
  const markedFiles: string[] = [];
  let fixme = 0;
  let todo = 0;

  for (const file of files) {
    const fileTodo = file.todo ?? 0;
    const fileFixme = file.fixme ?? 0;

    if (fileTodo + fileFixme > 0) {
      markedFiles.push(file.path);
      todo += fileTodo;
      fixme += fileFixme;
    }
  }

  return {
    files: markedFiles,
    fixme,
    todo
  };
}

function inferAreaKey(files: Array<{ category?: string; path: string }>): string {
  const firstSource = files.find((file) => file.category === 'source' || file.category === 'test') ?? files[0];

  if (firstSource === undefined) {
    return 'workspace';
  }

  const parts = firstSource.path.split('/').filter(Boolean);

  if (parts[0] === 'packages' || parts[0] === 'apps') {
    return parts[1] === undefined ? parts[0] : `${parts[0]}/${parts[1]}`;
  }

  if (parts[0] === 'src' && parts[1] !== undefined) {
    return `${parts[0]}/${parts[1]}`;
  }

  if (firstSource.category === 'config') {
    return 'project-config';
  }

  if (firstSource.category === 'docs') {
    return 'docs';
  }

  if (firstSource.category === 'test') {
    return 'tests';
  }

  return parts[0] ?? 'workspace';
}

function toParaKey(value: string): string {
  const key = value
    .replace(/\\/g, '/')
    .replace(/[^A-Za-z0-9._/-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return key || 'captured-events';
}

function isNonEmptyString(value: string | undefined): value is string {
  return value !== undefined && value.length > 0;
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
  },
  {
    regex: /\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/gi,
    kind: 'pii',
    severity: 'medium',
    label: 'email',
    secretGroup: 1
  },
  {
    regex: /(?:^|[^\d])(\+?\d[\d .()-]{7,}\d)(?!\d)/g,
    kind: 'pii',
    severity: 'medium',
    label: 'phone',
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
