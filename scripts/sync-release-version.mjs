import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const rootPackagePath = 'package.json';
const cliPackagePath = join('apps', 'dmx', 'package.json');
const sharedSourcePath = join('packages', 'shared', 'src', 'index.ts');
const rootPackage = readPackageJson(rootPackagePath);
const cliPackage = readPackageJson(cliPackagePath);
const sharedSource = readFileSync(sharedSourcePath, 'utf8');
const versionConstantPattern = /export const DEV_MESH_VERSION = '[^']+';/;

if (!versionConstantPattern.test(sharedSource)) {
  throw new Error(`Could not find DEV_MESH_VERSION in ${sharedSourcePath}`);
}

const nextSharedSource = sharedSource.replace(
  versionConstantPattern,
  `export const DEV_MESH_VERSION = '${rootPackage.version}';`
);

if (cliPackage.version === rootPackage.version && nextSharedSource === sharedSource) {
  console.log(`Release version already synchronized: ${rootPackage.version}`);
  process.exit(0);
}

if (cliPackage.version !== rootPackage.version) {
  cliPackage.version = rootPackage.version;
  writePackageJson(cliPackagePath, cliPackage);
  console.log(`Synchronized apps/dmx/package.json to ${rootPackage.version}`);
}

if (nextSharedSource !== sharedSource) {
  writeFileSync(sharedSourcePath, nextSharedSource, 'utf8');
  console.log(`Synchronized DEV_MESH_VERSION to ${rootPackage.version}`);
}

function readPackageJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writePackageJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
