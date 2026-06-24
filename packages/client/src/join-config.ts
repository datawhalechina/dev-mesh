import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  escapeToml,
  getGlobalConfigPaths,
  readJsonFile,
  type GlobalConfigPaths,
  writeJsonFile
} from './global-config.js';
import { initGlobalConfig } from './global-init.js';
import type { JoinedServerRecord } from './join-types.js';

export async function persistJoinedServer(
  paths: GlobalConfigPaths,
  record: JoinedServerRecord,
  displayName: string
): Promise<void> {
  await ensureGlobalConfig(paths.globalRoot, displayName);
  await writeJoinedConfig(paths.configPath, record);
  await writeJoinedIdentity(paths.identityPath, record);
}

async function ensureGlobalConfig(globalRoot: string, displayName: string): Promise<void> {
  const paths = getGlobalConfigPaths(globalRoot);

  await mkdir(globalRoot, { recursive: true });

  try {
    await readFile(paths.configPath, 'utf8');
  } catch {
    await initGlobalConfig(displayName, { globalRoot, configureTools: false });
  }
}

async function writeJoinedConfig(configPath: string, record: JoinedServerRecord): Promise<void> {
  const existing = await readFile(configPath, 'utf8');
  const withoutPreviousJoin = removeJoinedBlocks(existing, record);
  const withAutoSync = setAutomationAutoSync(withoutPreviousJoin);

  await writeFile(configPath, `${withAutoSync.trimEnd()}\n\n${createJoinedConfigBlocks(record)}`, 'utf8');
}

async function writeJoinedIdentity(identityPath: string, record: JoinedServerRecord): Promise<void> {
  const identity = await readJsonFile<{
    joinedServers?: JoinedServerRecord[];
    [key: string]: unknown;
  }>(identityPath, {});
  const joinedServers = (identity.joinedServers ?? []).filter(
    (item) => !(item.serverUrl === record.serverUrl && item.branch === record.branch)
  );

  joinedServers.push(record);
  await writeJsonFile(identityPath, {
    ...identity,
    joinedServers
  });
}

function createJoinedConfigBlocks(record: JoinedServerRecord): string {
  const lines = [
    '[[servers]]',
    `server_url = "${escapeToml(record.serverUrl)}"`,
    `mcp_url = "${escapeToml(record.mcpUrl)}"`,
    `client_id = "${escapeToml(record.clientId)}"`,
    `joined_at = "${escapeToml(record.joinedAt)}"`
  ];

  if (record.expiresAt !== undefined) {
    lines.push(`token_expires_at = "${escapeToml(record.expiresAt)}"`);
  }

  // Keep credentials out of TOML so config can be inspected or shared without
  // exposing tokens or signing secrets. identity.json is the temporary local
  // secret holder.
  lines.push(
    '',
    '[[groups]]',
    `server_url = "${escapeToml(record.serverUrl)}"`,
    `group_key = "${escapeToml(record.branch)}"`,
    `member_id = "${escapeToml(record.memberId)}"`,
    `client_id = "${escapeToml(record.clientId)}"`,
    `display_name = "${escapeToml(record.displayName)}"`,
    'auto_sync = true'
  );

  if (record.handle !== undefined) {
    lines.push(`handle = "${escapeToml(record.handle)}"`);
  }

  lines.push('');

  return lines.join('\n');
}

function removeJoinedBlocks(content: string, record: JoinedServerRecord): string {
  const lines = content.split(/\r?\n/);
  const output: string[] = [];

  for (let index = 0; index < lines.length; ) {
    const line = lines[index]?.trim();

    if (line === '[[servers]]' || line === '[[groups]]') {
      const block: string[] = [];

      while (index < lines.length) {
        const current = lines[index] ?? '';
        const trimmed = current.trim();

        if (block.length > 0 && (trimmed.startsWith('[[') || /^\[[^\]]+\]$/.test(trimmed))) {
          break;
        }

        block.push(current);
        index += 1;
      }

      if (!isMatchingJoinBlock(block, record)) {
        output.push(...block);
      }

      continue;
    }

    output.push(lines[index] ?? '');
    index += 1;
  }

  return output.join('\n');
}

function isMatchingJoinBlock(block: string[], record: JoinedServerRecord): boolean {
  const text = block.join('\n');
  const serverMatch = text.includes(`server_url = "${escapeToml(record.serverUrl)}"`);

  if (block[0]?.trim() === '[[servers]]') {
    return serverMatch;
  }

  return serverMatch && text.includes(`group_key = "${escapeToml(record.branch)}"`);
}

function setAutomationAutoSync(content: string): string {
  const lines = content.split(/\r?\n/);
  const output: string[] = [];
  let inAutomation = false;
  let sawAutomation = false;
  let autoSyncWritten = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^\[[^\]]+\]$/.test(trimmed)) {
      if (inAutomation && !autoSyncWritten) {
        output.push('auto_sync = true');
      }

      inAutomation = trimmed === '[automation]';
      sawAutomation ||= inAutomation;
      autoSyncWritten = false;
    }

    if (inAutomation && /^auto_sync\s*=/.test(trimmed)) {
      output.push('auto_sync = true');
      autoSyncWritten = true;
      continue;
    }

    output.push(line);
  }

  if (inAutomation && !autoSyncWritten) {
    output.push('auto_sync = true');
  }

  if (!sawAutomation) {
    return `${output.join('\n').trimEnd()}\n\n[automation]\nauto_sync = true\n`;
  }

  return output.join('\n');
}
