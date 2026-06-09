import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const rootPackage = readPackageJson('package.json');
const cliPackage = readPackageJson(join('apps', 'dmx', 'package.json'));
const sharedVersion = readSharedVersion(join('packages', 'shared', 'src', 'index.ts'));
const expectedTag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : readCurrentTag();
const mismatches = [];

if (rootPackage.version !== cliPackage.version) {
  mismatches.push(`package.json is ${rootPackage.version}, apps/dmx/package.json is ${cliPackage.version}`);
}

if (rootPackage.version !== sharedVersion) {
  mismatches.push(`package.json is ${rootPackage.version}, DEV_MESH_VERSION is ${sharedVersion}`);
}

if (expectedTag !== undefined && expectedTag !== `v${cliPackage.version}`) {
  mismatches.push(`git tag is ${expectedTag}, apps/dmx/package.json expects v${cliPackage.version}`);
}

if (mismatches.length > 0) {
  console.error(['Release version mismatch:', ...mismatches.map((item) => `- ${item}`)].join('\n'));
  process.exit(1);
}

console.log(`Release version check passed: ${cliPackage.version}`);

function readPackageJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readSharedVersion(path) {
  const match = /export const DEV_MESH_VERSION = '([^']+)';/.exec(readFileSync(path, 'utf8'));

  if (match === null) {
    throw new Error(`Could not find DEV_MESH_VERSION in ${path}`);
  }

  return match[1];
}

function readCurrentTag() {
  try {
    const tag = execFileSync('git', ['describe', '--tags', '--exact-match', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();

    return tag.length > 0 ? tag : undefined;
  } catch {
    return undefined;
  }
}
