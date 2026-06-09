import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEV_MESH_DIR } from '@devmesh/local-store';
import { compactChecks } from './doctor-summary.js';
import type { DevMeshDoctorCheck, DoctorContext } from './doctor-types.js';

export async function checkPrivacy(context: DoctorContext): Promise<DevMeshDoctorCheck[]> {
  const config = context.projectConfig;
  const checks: DevMeshDoctorCheck[] = [];

  if (config === undefined) {
    return [
      {
        id: 'privacy.config',
        category: 'privacy',
        status: 'error',
        message: 'Privacy settings could not be read because the project store check failed.',
        fixHint: `Run dmx init --root "${context.projectRoot}" before re-running doctor.`
      }
    ];
  }

  checks.push({
    id: 'privacy.redaction',
    category: 'privacy',
    status: config.privacy.redactionEnabled ? 'ok' : 'error',
    message: config.privacy.redactionEnabled
      ? 'Redaction is enabled before local captures are written.'
      : 'Redaction is disabled for this project.',
    fixHint: config.privacy.redactionEnabled ? undefined : 'Set privacy.redaction_enabled = true in .dev-mesh/config.toml.'
  });

  checks.push({
    id: 'privacy.raw-transcripts',
    category: 'privacy',
    status: config.privacy.uploadRawTranscripts ? 'warn' : 'ok',
    message: config.privacy.uploadRawTranscripts
      ? 'Raw transcript upload is enabled.'
      : 'Raw transcript upload is disabled.',
    fixHint: config.privacy.uploadRawTranscripts
      ? 'Set privacy.upload_raw_transcripts = false unless a project policy explicitly allows it.'
      : undefined
  });

  checks.push({
    id: 'privacy.large-source',
    category: 'privacy',
    status: config.privacy.uploadLargeSourceBlocks ? 'warn' : 'ok',
    message: config.privacy.uploadLargeSourceBlocks
      ? 'Large source block upload is enabled.'
      : 'Large source block upload is disabled.',
    fixHint: config.privacy.uploadLargeSourceBlocks
      ? 'Set privacy.upload_large_source_blocks = false to avoid uploading bulky or sensitive source snippets.'
      : undefined
  });

  checks.push(await checkStoreGitignore(context.projectRoot));

  return compactChecks(checks);
}

async function checkStoreGitignore(projectRoot: string): Promise<DevMeshDoctorCheck> {
  const gitignorePath = join(projectRoot, DEV_MESH_DIR, '.gitignore');

  try {
    const content = await readFile(gitignorePath, 'utf8');
    const requiredPatterns = ['secrets/', 'events/', 'sync/', 'knowledge/raw/'];
    const missing = requiredPatterns.filter((pattern) => !content.includes(pattern));

    if (missing.length > 0) {
      return {
        id: 'privacy.store-gitignore',
        category: 'privacy',
        status: 'warn',
        message: `.dev-mesh/.gitignore is missing ${missing.join(', ')}.`,
        fixHint: `Add ${missing.join(', ')} to ${gitignorePath}.`
      };
    }

    return {
      id: 'privacy.store-gitignore',
      category: 'privacy',
      status: 'ok',
      message: '.dev-mesh/.gitignore excludes local secrets, events, sync state, and raw knowledge.'
    };
  } catch {
    return {
      id: 'privacy.store-gitignore',
      category: 'privacy',
      status: 'warn',
      message: '.dev-mesh/.gitignore could not be read.',
      fixHint: `Run dmx init --root "${projectRoot}" to recreate the default store ignore file.`
    };
  }
}
