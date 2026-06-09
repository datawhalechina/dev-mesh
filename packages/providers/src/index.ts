import { execFile } from 'node:child_process';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { promisify } from 'node:util';
import type { ProjectScanContext, ProjectScanProvider, ProjectScanRecord } from '@devmesh/extension-api';

const execFileAsync = promisify(execFile);

export interface GitProjectScanProviderOptions {
  command?: string;
  now?: () => Date;
}

export interface GitTestResultSummary {
  command?: string;
  exitCode?: number;
  passed?: boolean;
  summary?: string;
}

export interface FileSystemProjectScanProviderOptions {
  maxFiles?: number;
  maxTextBytes?: number;
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

export function createGitProjectScanProvider(options: GitProjectScanProviderOptions = {}): ProjectScanProvider {
  return {
    id: 'devmesh.provider.git',
    kind: 'project-scan-provider',
    capabilities: ['project.scan.git'],
    priority: 50,
    async detect(projectRoot: string) {
      const result = await runGit(projectRoot, ['rev-parse', '--is-inside-work-tree'], options);

      return result.stdout.trim() === 'true';
    },
    async *collect(ctx: ProjectScanContext): AsyncIterable<ProjectScanRecord> {
      const snapshot = await collectGitSnapshot(ctx, options);
      const createdAt = (options.now?.() ?? new Date()).toISOString();

      yield {
        id: `scan_git_${createdAt.replace(/[^0-9A-Za-z]/g, '')}`,
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

export function createFileSystemProjectScanProvider(
  options: FileSystemProjectScanProviderOptions = {}
): ProjectScanProvider {
  return {
    id: 'devmesh.provider.filesystem',
    kind: 'project-scan-provider',
    capabilities: ['project.scan.filesystem'],
    priority: 40,
    async detect(projectRoot: string) {
      try {
        const stats = await lstat(projectRoot);
        return stats.isDirectory();
      } catch {
        return false;
      }
    },
    async *collect(ctx: ProjectScanContext): AsyncIterable<ProjectScanRecord> {
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
        id: `scan_fs_${createdAt.replace(/[^0-9A-Za-z]/g, '')}`,
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

async function collectGitSnapshot(
  ctx: ProjectScanContext,
  options: GitProjectScanProviderOptions
): Promise<GitSnapshot> {
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
  ctx: ProjectScanContext,
  options: FileSystemProjectScanProviderOptions
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
  options: FileSystemProjectScanProviderOptions
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
  options: GitProjectScanProviderOptions
): Promise<GitCommandResult> {
  try {
    const result = await execFileAsync(options.command ?? 'git', ['-C', projectRoot, ...args], {
      maxBuffer: 1024 * 1024,
      windowsHide: true
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
  options: GitProjectScanProviderOptions
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

function readTestResultSummary(metadata: ProjectScanContext['metadata']): GitTestResultSummary | undefined {
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

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
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
  '.dev-mesh/visualizations/**',
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
