import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const rootPackage = readPackageJson('package.json');
const cliPackage = readPackageJson(join('apps', 'dmx', 'package.json'));
const expectedTag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : readCurrentTag();
const mismatches = [];

if (rootPackage.version !== cliPackage.version) {
  mismatches.push(`package.json is ${rootPackage.version}, apps/dmx/package.json is ${cliPackage.version}`);
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
