import { execFile } from 'node:child_process';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { promisify } from 'node:util';
import type { CaptureContext, CaptureProvider, RawEvent } from '@mcp-dev-mesh/extension-api';

const execFileAsync = promisify(execFile);

export interface GitCaptureProviderOptions {
  command?: string;
  now?: () => Date;
}

export interface GitTestResultSummary {
  command?: string;
  exitCode?: number;
  passed?: boolean;
  summary?: string;
}

export interface FileSystemCaptureProviderOptions {
  maxFiles?: number;
  maxTextBytes?: number;
  now?: () => Date;
}

export interface McpToolCallCaptureProviderOptions {
  maxErrorMessageLength?: number;
  now?: () => Date;
}

interface GitSnapshot {
  branch?: string;
  changedFiles: GitChangedFile[];
  diffStat?: string;
  headCommit?: string;
  headSubject?: string;
  issueKeys: string[];
  testResult?: GitTestResultSummary;
}

interface GitChangedFile {
  path: string;
  status: string;
  additions?: number;
  deletions?: number;
}

interface GitCommandResult {
  stdout: string;
  stderr: string;
}

type FileSystemFileCategory = 'asset' | 'config' | 'docs' | 'source' | 'test' | 'unknown';
type IgnoreReason = 'meshignore' | 'privacy' | 'unsupported' | 'workspace';

interface FileSystemSnapshot {
  files: FileSystemChangedFile[];
  ignored: Record<IgnoreReason, number>;
  policy: {
    meshignoreRules: number;
    privacyRules: number;
    workspaceRules: number;
  };
  truncated: boolean;
  since?: string;
}

interface FileSystemChangedFile {
  path: string;
  event: 'modified';
  size: number;
  mtime: string;
  category: FileSystemFileCategory;
  extension?: string;
  markers?: {
    fixme?: number;
    todo?: number;
  };
  textScan?: 'skipped-large';
}

interface FileIgnorePolicy {
  meshignoreRules: IgnoreRule[];
  privacyRules: IgnoreRule[];
  workspaceRules: IgnoreRule[];
  hasMeshignoreNegation: boolean;
}

interface IgnoreRule {
  negative: boolean;
  pattern: string;
  matcher: (relativePath: string, isDirectory: boolean) => boolean;
}

interface NormalizedMcpToolCall {
  toolName: string;
  argumentKeys: string[];
  failed: boolean;
  status: 'failed' | 'succeeded';
  durationMs?: number;
  endedAt?: string;
  error?: McpToolErrorSummary;
  host?: string;
  result?: McpToolResultSummary;
  server?: string;
  startedAt?: string;
}

interface McpToolResultSummary {
  kind: 'array' | 'boolean' | 'mcp-content' | 'null' | 'number' | 'object' | 'string' | 'undefined';
  contentItems?: number;
  contentTypes?: string[];
  itemCount?: number;
  keys?: string[];
  length?: number;
  textChars?: number;
}

interface McpToolErrorSummary {
  code?: string;
  keys?: string[];
  message?: string;
  name?: string;
}

export function createGitCaptureProvider(options: GitCaptureProviderOptions = {}): CaptureProvider {
  return {
    id: 'dev-mesh.provider.git',
    kind: 'capture-provider',
    capabilities: ['capture.git'],
    priority: 50,
    async detect(projectRoot: string) {
      const result = await runGit(projectRoot, ['rev-parse', '--is-inside-work-tree'], options);

      return result.stdout.trim() === 'true';
    },
    async *collect(ctx: CaptureContext): AsyncIterable<RawEvent> {
      const snapshot = await collectGitSnapshot(ctx, options);
      const createdAt = (options.now?.() ?? new Date()).toISOString();

      yield {
        id: `raw_git_${createdAt.replace(/[^0-9A-Za-z]/g, '')}`,
        kind: 'git.snapshot',
        summary: summarizeGitSnapshot(snapshot),
        payload: {
          branch: snapshot.branch,
          headCommit: snapshot.headCommit,
          headSubject: snapshot.headSubject,
          changedFiles: snapshot.changedFiles,
          diffStat: snapshot.diffStat,
          issueKeys: snapshot.issueKeys,
          testResult: snapshot.testResult
        },
        createdAt,
        source: {
          kind: 'git',
          projectRoot: ctx.projectRoot
        }
      };
    }
  };
}

export function createFileSystemCaptureProvider(options: FileSystemCaptureProviderOptions = {}): CaptureProvider {
  return {
    id: 'dev-mesh.provider.filesystem',
    kind: 'capture-provider',
    capabilities: ['capture.filesystem'],
    priority: 40,
    async detect(projectRoot: string) {
      try {
        const stats = await lstat(projectRoot);
        return stats.isDirectory();
      } catch {
        return false;
      }
    },
    async *collect(ctx: CaptureContext): AsyncIterable<RawEvent> {
      const snapshot = await collectFileSystemSnapshot(ctx, options);
      const createdAt = (options.now?.() ?? new Date()).toISOString();
      const payload: Record<string, unknown> = {
        files: snapshot.files,
        ignored: snapshot.ignored,
        policy: snapshot.policy,
        truncated: snapshot.truncated
      };

      if (snapshot.since !== undefined) {
        payload.since = snapshot.since;
      }

      yield {
        id: `raw_fs_${createdAt.replace(/[^0-9A-Za-z]/g, '')}`,
        kind: 'filesystem.snapshot',
        summary: summarizeFileSystemSnapshot(snapshot),
        payload,
        createdAt,
        source: {
          kind: 'filesystem',
          projectRoot: ctx.projectRoot
        }
      };
    }
  };
}

export function createMcpToolCallCaptureProvider(options: McpToolCallCaptureProviderOptions = {}): CaptureProvider {
  return {
    id: 'dev-mesh.provider.mcp-tool',
    kind: 'capture-provider',
    capabilities: ['capture.mcp-tool'],
    priority: 35,
    async detect(projectRoot: string) {
      try {
        const stats = await lstat(projectRoot);
        return stats.isDirectory();
      } catch {
        return false;
      }
    },
    async *collect(ctx: CaptureContext): AsyncIterable<RawEvent> {
      const calls = readMcpToolCalls(ctx.metadata, options);
      const fallbackCreatedAt = (options.now?.() ?? new Date()).toISOString();

      for (const [index, call] of calls.entries()) {
        const createdAt = call.endedAt ?? fallbackCreatedAt;
        const payload = createMcpToolPayload(call);

        yield {
          id: `raw_mcp_tool_${createdAt.replace(/[^0-9A-Za-z]/g, '')}_${index}`,
          kind: 'mcp.tool_call',
          summary: summarizeMcpToolCall(call),
          payload,
          createdAt,
          source: {
            kind: 'mcp-tool',
            projectRoot: ctx.projectRoot
          }
        };
      }
    }
  };
}

export function createBuiltInProviders(): CaptureProvider[] {
  return [createGitCaptureProvider(), createFileSystemCaptureProvider(), createMcpToolCallCaptureProvider()];
}

async function collectGitSnapshot(ctx: CaptureContext, options: GitCaptureProviderOptions): Promise<GitSnapshot> {
  const [branch, headCommit, headSubject, status, numstat, diffStat] = await Promise.all([
    readGitValue(ctx.projectRoot, ['branch', '--show-current'], options),
    readGitValue(ctx.projectRoot, ['rev-parse', 'HEAD'], options),
    readGitValue(ctx.projectRoot, ['log', '-1', '--pretty=%s'], options),
    readGitValue(ctx.projectRoot, ['status', '--porcelain=v1'], options),
    readGitValue(ctx.projectRoot, ['diff', '--numstat'], options),
    readGitValue(ctx.projectRoot, ['diff', '--stat', '--compact-summary'], options)
  ]);
  const changedFiles = mergeChangedFiles(parseGitStatus(status), parseGitNumstat(numstat));
  const testResult = readTestResultSummary(ctx.metadata);
  const issueKeys = findIssueKeys([branch, headSubject, ...changedFiles.map((file) => file.path)].filter(isString));
  const snapshot: GitSnapshot = {
    changedFiles,
    issueKeys
  };

  if (branch !== undefined) {
    snapshot.branch = branch;
  }

  if (headCommit !== undefined) {
    snapshot.headCommit = headCommit;
  }

  if (headSubject !== undefined) {
    snapshot.headSubject = headSubject;
  }

  if (diffStat !== undefined) {
    snapshot.diffStat = diffStat;
  }

  if (testResult !== undefined) {
    snapshot.testResult = testResult;
  }

  return snapshot;
}

async function collectFileSystemSnapshot(
  ctx: CaptureContext,
  options: FileSystemCaptureProviderOptions
): Promise<FileSystemSnapshot> {
  const ignored = createIgnoredSummary();
  const policy = await loadFileIgnorePolicy(ctx.projectRoot);
  const files: FileSystemChangedFile[] = [];
  const sinceDate = parseSince(ctx.since);
  let truncated = false;

  async function visit(directory: string): Promise<void> {
    if (truncated) {
      return;
    }

    let entries;

    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      ignored.unsupported += 1;
      return;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (truncated) {
        return;
      }

      const absolutePath = join(directory, entry.name);
      const relativePath = toProjectRelativePath(ctx.projectRoot, absolutePath);

      if (relativePath === undefined) {
        ignored.unsupported += 1;
        continue;
      }

      const isDirectory = entry.isDirectory();
      const ignoreReason = evaluateIgnorePolicy(policy, relativePath, isDirectory);

      if (ignoreReason !== undefined) {
        if (isDirectory && ignoreReason === 'meshignore' && policy.hasMeshignoreNegation) {
          await visit(absolutePath);
        } else {
          ignored[ignoreReason] += 1;
        }

        continue;
      }

      if (isDirectory) {
        await visit(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        ignored.unsupported += 1;
        continue;
      }

      const file = await readChangedFile(absolutePath, relativePath, sinceDate, options);

      if (file === undefined) {
        continue;
      }

      if (files.length >= (options.maxFiles ?? 200)) {
        truncated = true;
        return;
      }

      files.push(file);
    }
  }

  await visit(ctx.projectRoot);

  const snapshot: FileSystemSnapshot = {
    files,
    ignored,
    policy: {
      meshignoreRules: policy.meshignoreRules.length,
      privacyRules: policy.privacyRules.length,
      workspaceRules: policy.workspaceRules.length
    },
    truncated
  };

  if (ctx.since !== undefined) {
    snapshot.since = ctx.since;
  }

  return snapshot;
}

async function readChangedFile(
  absolutePath: string,
  relativePath: string,
  sinceDate: Date | undefined,
  options: FileSystemCaptureProviderOptions
): Promise<FileSystemChangedFile | undefined> {
  let stats;

  try {
    stats = await lstat(absolutePath);
  } catch {
    return undefined;
  }

  if (sinceDate !== undefined && stats.mtime <= sinceDate) {
    return undefined;
  }

  const extension = extname(relativePath).toLowerCase();
  const file: FileSystemChangedFile = {
    path: relativePath,
    event: 'modified',
    size: stats.size,
    mtime: stats.mtime.toISOString(),
    category: classifyFile(relativePath)
  };

  if (extension) {
    file.extension = extension;
  }

  const maxTextBytes = options.maxTextBytes ?? 64 * 1024;

  if (isTextFile(relativePath)) {
    if (stats.size > maxTextBytes) {
      file.textScan = 'skipped-large';
    } else {
      const markers = await readTodoMarkers(absolutePath);

      if (markers !== undefined) {
        file.markers = markers;
      }
    }
  }

  return file;
}

async function runGit(
  projectRoot: string,
  args: string[],
  options: GitCaptureProviderOptions
): Promise<GitCommandResult> {
  try {
    const result = await execFileAsync(options.command ?? 'git', ['-C', projectRoot, ...args], {
      maxBuffer: 1024 * 1024
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    const processError = error as { stdout?: string; stderr?: string };

    return {
      stdout: processError.stdout ?? '',
      stderr: processError.stderr ?? ''
    };
  }
}

async function readGitValue(
  projectRoot: string,
  args: string[],
  options: GitCaptureProviderOptions
): Promise<string | undefined> {
  const result = await runGit(projectRoot, args, options);
  const value = result.stdout.trim();

  return value ? value : undefined;
}

function parseGitStatus(status: string | undefined): GitChangedFile[] {
  if (status === undefined) {
    return [];
  }

  return status
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const match = /^(.{1,2})\s+(.+)$/.exec(line);
      const statusCode = match?.[1]?.trim() || line.slice(0, 2).trim() || line.slice(0, 2);
      const rawPath = (match?.[2] ?? line.slice(3)).trim();
      const renamed = rawPath.split(/\s+->\s+/);

      return {
        path: renamed.at(-1) ?? rawPath,
        status: statusCode
      };
    });
}

function parseGitNumstat(numstat: string | undefined): Map<string, Pick<GitChangedFile, 'additions' | 'deletions'>> {
  const stats = new Map<string, Pick<GitChangedFile, 'additions' | 'deletions'>>();

  if (numstat === undefined) {
    return stats;
  }

  for (const line of numstat.split(/\r?\n/)) {
    const [additions, deletions, ...pathParts] = line.split(/\t/);
    const path = pathParts.join('\t');

    if (!path) {
      continue;
    }

    const parsed: Pick<GitChangedFile, 'additions' | 'deletions'> = {};
    const additionsCount = parseNumstatCount(additions);
    const deletionsCount = parseNumstatCount(deletions);

    if (additionsCount !== undefined) {
      parsed.additions = additionsCount;
    }

    if (deletionsCount !== undefined) {
      parsed.deletions = deletionsCount;
    }

    stats.set(path, parsed);
  }

  return stats;
}

function parseNumstatCount(value: string | undefined): number | undefined {
  if (value === undefined || value === '-') {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : undefined;
}

function mergeChangedFiles(
  statusFiles: GitChangedFile[],
  numstat: Map<string, Pick<GitChangedFile, 'additions' | 'deletions'>>
): GitChangedFile[] {
  const filesByPath = new Map<string, GitChangedFile>();

  for (const file of statusFiles) {
    filesByPath.set(file.path, {
      ...file,
      ...numstat.get(file.path)
    });
  }

  for (const [path, stats] of numstat) {
    if (filesByPath.has(path)) {
      continue;
    }

    filesByPath.set(path, {
      path,
      status: 'M',
      ...stats
    });
  }

  return [...filesByPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function readTestResultSummary(metadata: CaptureContext['metadata']): GitTestResultSummary | undefined {
  if (metadata === undefined) {
    return undefined;
  }

  const testResult = readRecord(metadata.testResult);
  const summary: GitTestResultSummary = {};
  const command = metadata.testCommand ?? testResult.command;
  const exitCode = metadata.testExitCode ?? testResult.exitCode;
  const passed = metadata.testPassed ?? testResult.passed;
  const resultSummary = metadata.testSummary ?? testResult.summary;

  if (typeof command === 'string') {
    summary.command = command;
  }

  if (typeof exitCode === 'number') {
    summary.exitCode = exitCode;
  }

  if (typeof passed === 'boolean') {
    summary.passed = passed;
  }

  if (typeof resultSummary === 'string') {
    summary.summary = resultSummary;
  }

  return Object.keys(summary).length > 0 ? summary : undefined;
}

function summarizeGitSnapshot(snapshot: GitSnapshot): string {
  const branch = snapshot.branch ?? 'detached';
  const commit = snapshot.headCommit?.slice(0, 7) ?? 'no-head';
  const changedCount = snapshot.changedFiles.length;
  const changedLabel = changedCount === 1 ? '1 changed file' : `${changedCount} changed files`;
  const testLabel =
    snapshot.testResult === undefined
      ? undefined
      : `tests ${snapshot.testResult.passed === false ? 'failed' : 'passed'}${snapshot.testResult.command ? ` (${snapshot.testResult.command})` : ''}`;

  return [`Git snapshot on ${branch} at ${commit}: ${changedLabel}.`, snapshot.headSubject, testLabel]
    .filter(Boolean)
    .join(' ');
}

function summarizeFileSystemSnapshot(snapshot: FileSystemSnapshot): string {
  const changedCount = snapshot.files.length;
  const changedLabel = changedCount === 1 ? '1 file observed' : `${changedCount} files observed`;
  const sinceLabel = snapshot.since ? ` since ${snapshot.since}` : '';
  const markers = countTodoMarkers(snapshot.files);
  const markerLabel =
    markers.todo + markers.fixme > 0
      ? ` TODO/FIXME markers: ${markers.todo} TODO, ${markers.fixme} FIXME.`
      : '';
  const ignoredTotal = countIgnored(snapshot.ignored);
  const ignoredLabel = ignoredTotal > 0 ? ` ${ignoredTotal} paths ignored by privacy or mesh policy.` : '';
  const truncatedLabel = snapshot.truncated ? ' Result truncated.' : '';

  return `Filesystem snapshot${sinceLabel}: ${changedLabel}.${markerLabel}${ignoredLabel}${truncatedLabel}`;
}

function findIssueKeys(values: string[]): string[] {
  const keys = new Set<string>();
  const issueKeyPattern = /\b[A-Z][A-Z0-9]+-\d+\b/g;

  for (const value of values) {
    for (const match of value.matchAll(issueKeyPattern)) {
      keys.add(match[0]);
    }
  }

  return [...keys].sort();
}

function readMcpToolCalls(
  metadata: CaptureContext['metadata'],
  options: McpToolCallCaptureProviderOptions
): NormalizedMcpToolCall[] {
  const record = readRecord(metadata);
  const values = [
    ...readUnknownList(record.mcpToolCalls),
    ...readUnknownList(record.toolCalls),
    record.mcpToolCall,
    record.toolCall
  ];

  if (typeof record.toolName === 'string' || typeof record.name === 'string') {
    values.push(record);
  }

  return values
    .map((value) => normalizeMcpToolCall(value, options))
    .filter((call): call is NormalizedMcpToolCall => call !== undefined);
}

function normalizeMcpToolCall(
  value: unknown,
  options: McpToolCallCaptureProviderOptions
): NormalizedMcpToolCall | undefined {
  const record = readRecord(value);
  const toolName = readString(record.toolName) ?? readString(record.name);

  if (toolName === undefined) {
    return undefined;
  }

  const errorValue = record.error ?? record.errorMessage;
  const failed = readMcpToolCallFailed(record, errorValue);
  const call: NormalizedMcpToolCall = {
    toolName,
    argumentKeys: readArgumentKeys(record.arguments ?? record.args ?? record.input),
    failed,
    status: failed ? 'failed' : 'succeeded'
  };
  const durationMs = readNumber(record.durationMs) ?? readNumber(record.duration);
  const startedAt = readString(record.startedAt);
  const endedAt = readString(record.endedAt);
  const host = readString(record.host);
  const server = readString(record.server);
  const result = summarizeMcpToolResult(record.result ?? record.output ?? record.response);

  if (durationMs !== undefined) {
    call.durationMs = durationMs;
  }

  if (startedAt !== undefined) {
    call.startedAt = startedAt;
  }

  if (endedAt !== undefined) {
    call.endedAt = endedAt;
  }

  if (host !== undefined) {
    call.host = host;
  }

  if (server !== undefined) {
    call.server = server;
  }

  if (result !== undefined) {
    call.result = result;
  }

  if (errorValue !== undefined) {
    call.error = summarizeMcpToolError(errorValue, options);
  }

  return call;
}

function readMcpToolCallFailed(record: Record<string, unknown>, errorValue: unknown): boolean {
  const status = readString(record.status)?.toLowerCase();

  if (status === 'failed' || status === 'failure' || status === 'error') {
    return true;
  }

  if (status === 'ok' || status === 'success' || status === 'succeeded') {
    return false;
  }

  if (typeof record.success === 'boolean') {
    return !record.success;
  }

  return errorValue !== undefined && errorValue !== null;
}

function readArgumentKeys(value: unknown): string[] {
  const record = readRecord(value);

  return Object.keys(record).sort();
}

function summarizeMcpToolResult(value: unknown): McpToolResultSummary | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return { kind: 'null' };
  }

  if (Array.isArray(value)) {
    return {
      kind: 'array',
      itemCount: value.length
    };
  }

  if (typeof value === 'string') {
    return {
      kind: 'string',
      length: value.length
    };
  }

  if (typeof value === 'number') {
    return { kind: 'number' };
  }

  if (typeof value === 'boolean') {
    return { kind: 'boolean' };
  }

  const record = readRecord(value);
  const content = readUnknownList(record.content);

  if (content.length > 0) {
    return {
      kind: 'mcp-content',
      contentItems: content.length,
      contentTypes: readMcpContentTypes(content),
      textChars: countMcpTextChars(content)
    };
  }

  const keys = Object.keys(record).sort();
  const result: McpToolResultSummary = {
    kind: 'object',
    keys
  };
  const items = readUnknownList(record.items);

  if (items.length > 0) {
    result.itemCount = items.length;
  }

  return result;
}

function summarizeMcpToolError(value: unknown, options: McpToolCallCaptureProviderOptions): McpToolErrorSummary {
  if (typeof value === 'string') {
    return {
      message: redactSensitiveText(value, options.maxErrorMessageLength ?? 240)
    };
  }

  const record = readRecord(value);
  const summary: McpToolErrorSummary = {
    keys: Object.keys(record).sort()
  };
  const name = readString(record.name);
  const code = readString(record.code);
  const message = readString(record.message);

  if (name !== undefined) {
    summary.name = name;
  }

  if (code !== undefined) {
    summary.code = code;
  }

  if (message !== undefined) {
    summary.message = redactSensitiveText(message, options.maxErrorMessageLength ?? 240);
  }

  return summary;
}

function createMcpToolPayload(call: NormalizedMcpToolCall): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    toolName: call.toolName,
    status: call.status,
    failed: call.failed,
    argumentKeys: call.argumentKeys
  };

  if (call.durationMs !== undefined) {
    payload.durationMs = call.durationMs;
  }

  if (call.startedAt !== undefined) {
    payload.startedAt = call.startedAt;
  }

  if (call.endedAt !== undefined) {
    payload.endedAt = call.endedAt;
  }

  if (call.host !== undefined) {
    payload.host = call.host;
  }

  if (call.server !== undefined) {
    payload.server = call.server;
  }

  if (call.result !== undefined) {
    payload.result = call.result;
  }

  if (call.error !== undefined) {
    payload.error = call.error;
  }

  return payload;
}

function summarizeMcpToolCall(call: NormalizedMcpToolCall): string {
  const status = call.failed ? 'failed' : 'succeeded';
  const duration = call.durationMs === undefined ? '' : ` in ${call.durationMs}ms`;
  const error = call.error?.message ? `: ${call.error.message}` : '';

  return `MCP tool ${call.toolName} ${status}${duration}${error}.`;
}

function readMcpContentTypes(content: unknown[]): string[] {
  const types = new Set<string>();

  for (const item of content) {
    const type = readString(readRecord(item).type);

    if (type !== undefined) {
      types.add(type);
    }
  }

  return [...types].sort();
}

function countMcpTextChars(content: unknown[]): number {
  let total = 0;

  for (const item of content) {
    const text = readString(readRecord(item).text);

    if (text !== undefined) {
      total += text.length;
    }
  }

  return total;
}

async function loadFileIgnorePolicy(projectRoot: string): Promise<FileIgnorePolicy> {
  const meshignoreRules = await readMeshignoreRules(projectRoot);

  return {
    meshignoreRules,
    privacyRules: compileIgnoreRules(DEFAULT_PRIVACY_IGNORE_PATTERNS, false),
    workspaceRules: compileIgnoreRules(DEFAULT_WORKSPACE_IGNORE_PATTERNS, false),
    hasMeshignoreNegation: meshignoreRules.some((rule) => rule.negative)
  };
}

async function readMeshignoreRules(projectRoot: string): Promise<IgnoreRule[]> {
  try {
    const content = await readFile(join(projectRoot, '.meshignore'), 'utf8');
    return compileIgnoreRules(content.split(/\r?\n/), true);
  } catch {
    return [];
  }
}

function compileIgnoreRules(patterns: readonly string[], allowNegation: boolean): IgnoreRule[] {
  return patterns
    .map((pattern) => parseIgnoreRule(pattern, allowNegation))
    .filter((rule): rule is IgnoreRule => rule !== undefined);
}

function parseIgnoreRule(pattern: string, allowNegation: boolean): IgnoreRule | undefined {
  const trimmed = pattern.trim();

  if (!trimmed || trimmed.startsWith('#')) {
    return undefined;
  }

  const negative = allowNegation && trimmed.startsWith('!');
  const normalized = normalizeIgnorePattern(negative ? trimmed.slice(1).trim() : trimmed);

  if (!normalized) {
    return undefined;
  }

  return {
    negative,
    pattern: normalized,
    matcher: createIgnoreMatcher(normalized)
  };
}

function evaluateIgnorePolicy(
  policy: FileIgnorePolicy,
  relativePath: string,
  isDirectory: boolean
): IgnoreReason | undefined {
  if (policy.privacyRules.some((rule) => rule.matcher(relativePath, isDirectory))) {
    return 'privacy';
  }

  if (policy.workspaceRules.some((rule) => rule.matcher(relativePath, isDirectory))) {
    return 'workspace';
  }

  let meshIgnored = false;

  for (const rule of policy.meshignoreRules) {
    if (rule.matcher(relativePath, isDirectory)) {
      meshIgnored = !rule.negative;
    }
  }

  return meshIgnored ? 'meshignore' : undefined;
}

function createIgnoreMatcher(pattern: string): (relativePath: string, isDirectory: boolean) => boolean {
  const directoryOnly = pattern.endsWith('/');
  const cleaned = directoryOnly ? pattern.replace(/\/+$/g, '') : pattern;
  const anchored = cleaned.startsWith('/');
  const source = anchored ? cleaned.slice(1) : cleaned;
  const hasSlash = source.includes('/');
  const recursiveBase = source.endsWith('/**') ? source.slice(0, -3) : undefined;
  const exactRegex = compileGlobRegex(source, anchored || hasSlash, directoryOnly);
  const recursiveBaseRegex =
    recursiveBase === undefined
      ? undefined
      : compileGlobRegex(recursiveBase, anchored || recursiveBase.includes('/'), false);

  return (relativePath) => {
    const normalized = normalizePathForIgnore(relativePath);

    if (!normalized) {
      return false;
    }

    if (recursiveBaseRegex?.test(normalized)) {
      return true;
    }

    return exactRegex.test(normalized);
  };
}

function compileGlobRegex(pattern: string, anchored: boolean, matchDescendants: boolean): RegExp {
  const prefix = anchored ? '^' : '^(?:.*/)?';
  const suffix = matchDescendants ? '(?:/.*)?$' : '$';

  return new RegExp(`${prefix}${globToRegex(pattern)}${suffix}`);
}

function globToRegex(pattern: string): string {
  let regex = '';

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];

    if (char === '*') {
      if (pattern[index + 1] === '*') {
        regex += '.*';
        index += 1;
      } else {
        regex += '[^/]*';
      }

      continue;
    }

    if (char === '?') {
      regex += '[^/]';
      continue;
    }

    regex += escapeRegex(char);
  }

  return regex;
}

function escapeRegex(value: string | undefined): string {
  return (value ?? '').replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function normalizeIgnorePattern(pattern: string): string {
  return pattern.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
}

function normalizePathForIgnore(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

function toProjectRelativePath(projectRoot: string, absolutePath: string): string | undefined {
  const relativePath = normalizePathForIgnore(relative(projectRoot, absolutePath));

  if (!relativePath || relativePath === '..' || relativePath.startsWith('../')) {
    return undefined;
  }

  return relativePath;
}

function parseSince(since: string | undefined): Date | undefined {
  if (since === undefined) {
    return undefined;
  }

  const parsed = new Date(since);

  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function classifyFile(relativePath: string): FileSystemFileCategory {
  const normalized = normalizePathForIgnore(relativePath).toLowerCase();
  const basename = normalized.split('/').at(-1) ?? normalized;
  const extension = extname(normalized);

  if (normalized.startsWith('docs/') || extension === '.md' || extension === '.mdx' || extension === '.rst') {
    return 'docs';
  }

  if (
    basename === 'package.json' ||
    basename === 'pnpm-lock.yaml' ||
    basename === 'tsconfig.json' ||
    basename === '.meshignore' ||
    basename.endsWith('.config.ts') ||
    basename.endsWith('.config.js') ||
    extension === '.toml' ||
    extension === '.yaml' ||
    extension === '.yml'
  ) {
    return 'config';
  }

  if (/(^|\/)(tests?|__tests__)\/|\.test\.|\.spec\./.test(normalized)) {
    return 'test';
  }

  if (SOURCE_EXTENSIONS.has(extension)) {
    return 'source';
  }

  if (ASSET_EXTENSIONS.has(extension)) {
    return 'asset';
  }

  return 'unknown';
}

function isTextFile(relativePath: string): boolean {
  const normalized = normalizePathForIgnore(relativePath).toLowerCase();
  const basename = normalized.split('/').at(-1) ?? normalized;
  const extension = extname(normalized);

  return TEXT_EXTENSIONS.has(extension) || TEXT_BASENAMES.has(basename);
}

async function readTodoMarkers(absolutePath: string): Promise<FileSystemChangedFile['markers'] | undefined> {
  let text;

  try {
    text = await readFile(absolutePath, 'utf8');
  } catch {
    return undefined;
  }

  const todo = countMatches(text, /\bTODO\b/gi);
  const fixme = countMatches(text, /\bFIXME\b/gi);
  const markers: NonNullable<FileSystemChangedFile['markers']> = {};

  if (todo > 0) {
    markers.todo = todo;
  }

  if (fixme > 0) {
    markers.fixme = fixme;
  }

  return Object.keys(markers).length > 0 ? markers : undefined;
}

function countMatches(text: string, regex: RegExp): number {
  let count = 0;

  for (const _match of text.matchAll(regex)) {
    count += 1;
  }

  return count;
}

function countTodoMarkers(files: FileSystemChangedFile[]): { fixme: number; todo: number } {
  return files.reduce(
    (total, file) => ({
      fixme: total.fixme + (file.markers?.fixme ?? 0),
      todo: total.todo + (file.markers?.todo ?? 0)
    }),
    { fixme: 0, todo: 0 }
  );
}

function countIgnored(ignored: Record<IgnoreReason, number>): number {
  return Object.values(ignored).reduce((sum, count) => sum + count, 0);
}

function createIgnoredSummary(): Record<IgnoreReason, number> {
  return {
    meshignore: 0,
    privacy: 0,
    unsupported: 0,
    workspace: 0
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function readUnknownList(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  return [];
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function redactSensitiveText(text: string, maxLength: number): string {
  const redacted = text
    .replace(/\b(Authorization\s*:\s*(?:Bearer|Basic)\s+)([A-Za-z0-9._~+/=-]+)/gi, '$1[REDACTED:authorization]')
    .replace(/\b(Cookie\s*:\s*)([^\r\n]+)/gi, '$1[REDACTED:cookie]')
    .replace(/([?&](?:access_token|api_key|token|secret|signature|sig|password)=)([^&\s"'<>]+)/gi, '$1[REDACTED:url-token]')
    .replace(
      /(^|[^?&A-Z0-9_])([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*=\s*)([^\s"'`]+)/gi,
      '$1$2[REDACTED:env-secret]'
    )
    .replace(
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
      '[REDACTED:private-key]'
    );

  if (redacted.length <= maxLength) {
    return redacted;
  }

  return `${redacted.slice(0, Math.max(0, maxLength - 3))}...`;
}

function isString(value: string | undefined): value is string {
  return value !== undefined;
}

const DEFAULT_PRIVACY_IGNORE_PATTERNS = [
  '.env*',
  '**/.env*',
  '*.pem',
  '**/*.pem',
  '*.key',
  '**/*.key',
  'secrets/**',
  '**/secrets/**',
  '.dev-mesh/secrets/**',
  'customer-data/**',
  '**/customer-data/**'
];

const DEFAULT_WORKSPACE_IGNORE_PATTERNS = [
  '.git/**',
  '**/.git/**',
  'node_modules/**',
  '**/node_modules/**',
  'dist/**',
  '**/dist/**',
  'coverage/**',
  '**/coverage/**',
  '.dev-mesh/events/**',
  '.dev-mesh/index/**',
  '.dev-mesh/queue/**'
];

const SOURCE_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.cs',
  '.css',
  '.go',
  '.html',
  '.java',
  '.js',
  '.jsx',
  '.kt',
  '.php',
  '.py',
  '.rb',
  '.rs',
  '.scss',
  '.swift',
  '.ts',
  '.tsx',
  '.vue'
]);

const TEXT_EXTENSIONS = new Set([
  ...SOURCE_EXTENSIONS,
  '.csv',
  '.json',
  '.jsonc',
  '.lock',
  '.log',
  '.md',
  '.mdx',
  '.rst',
  '.sql',
  '.toml',
  '.txt',
  '.yaml',
  '.yml'
]);

const TEXT_BASENAMES = new Set(['dockerfile', 'makefile', 'readme', 'license']);

const ASSET_EXTENSIONS = new Set([
  '.avif',
  '.gif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.mp3',
  '.mp4',
  '.pdf',
  '.png',
  '.svg',
  '.webp',
  '.woff',
  '.woff2'
]);
