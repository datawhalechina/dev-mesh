import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const rootPackagePath = 'package.json';
const cliPackagePath = join('apps', 'dmx', 'package.json');
const rootPackage = readPackageJson(rootPackagePath);
const cliPackage = readPackageJson(cliPackagePath);

if (cliPackage.version === rootPackage.version) {
  console.log(`Release version already synchronized: ${rootPackage.version}`);
  process.exit(0);
}

cliPackage.version = rootPackage.version;
writePackageJson(cliPackagePath, cliPackage);
console.log(`Synchronized apps/dmx/package.json to ${rootPackage.version}`);

function readPackageJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writePackageJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
