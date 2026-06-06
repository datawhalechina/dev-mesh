import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '..', '..', '..');
const packagesRoot = join(repoRoot, 'packages');

const forbiddenByPackage: Record<string, string[]> = {
  '@mcp-dev-mesh/shared': [
    '@mcp-dev-mesh/extension-api',
    '@mcp-dev-mesh/core',
    '@mcp-dev-mesh/agent',
    '@mcp-dev-mesh/client',
    '@mcp-dev-mesh/server',
    '@mcp-dev-mesh/local-store',
    '@mcp-dev-mesh/mcp-contracts',
    '@mcp-dev-mesh/protocol',
    '@mcp-dev-mesh/adapters',
    '@mcp-dev-mesh/providers',
    '@mcp-dev-mesh/extractor',
    '@mcp-dev-mesh/quality',
    '@mcp-dev-mesh/search',
    '@mcp-dev-mesh/storage',
    '@mcp-dev-mesh/registry'
  ],
  '@mcp-dev-mesh/extension-api': [
    '@mcp-dev-mesh/core',
    '@mcp-dev-mesh/agent',
    '@mcp-dev-mesh/client',
    '@mcp-dev-mesh/server',
    '@mcp-dev-mesh/local-store',
    '@mcp-dev-mesh/mcp-contracts',
    '@mcp-dev-mesh/protocol',
    '@mcp-dev-mesh/adapters',
    '@mcp-dev-mesh/providers',
    '@mcp-dev-mesh/extractor',
    '@mcp-dev-mesh/quality',
    '@mcp-dev-mesh/search',
    '@mcp-dev-mesh/storage',
    '@mcp-dev-mesh/registry'
  ],
  '@mcp-dev-mesh/protocol': [
    '@mcp-dev-mesh/core',
    '@mcp-dev-mesh/agent',
    '@mcp-dev-mesh/client',
    '@mcp-dev-mesh/server',
    '@mcp-dev-mesh/local-store',
    '@mcp-dev-mesh/mcp-contracts',
    '@mcp-dev-mesh/adapters',
    '@mcp-dev-mesh/providers',
    '@mcp-dev-mesh/extractor',
    '@mcp-dev-mesh/quality',
    '@mcp-dev-mesh/search',
    '@mcp-dev-mesh/storage',
    '@mcp-dev-mesh/registry'
  ],
  '@mcp-dev-mesh/core': [
    '@mcp-dev-mesh/agent',
    '@mcp-dev-mesh/client',
    '@mcp-dev-mesh/server',
    '@mcp-dev-mesh/local-store',
    '@mcp-dev-mesh/mcp-contracts',
    '@mcp-dev-mesh/protocol',
    '@mcp-dev-mesh/adapters',
    '@mcp-dev-mesh/providers',
    '@mcp-dev-mesh/extractor',
    '@mcp-dev-mesh/quality',
    '@mcp-dev-mesh/search',
    '@mcp-dev-mesh/storage',
    '@mcp-dev-mesh/registry'
  ],
  '@mcp-dev-mesh/agent': ['@mcp-dev-mesh/client', '@mcp-dev-mesh/server', '@mcp-dev-mesh/local-store'],
  '@mcp-dev-mesh/local-store': ['@mcp-dev-mesh/agent', '@mcp-dev-mesh/client', '@mcp-dev-mesh/server'],
  '@mcp-dev-mesh/mcp-contracts': ['@mcp-dev-mesh/client', '@mcp-dev-mesh/server'],
  '@mcp-dev-mesh/client': ['@mcp-dev-mesh/server'],
  '@mcp-dev-mesh/server': ['@mcp-dev-mesh/client']
};

describe('workspace dependency direction', () => {
  it('keeps lower-level packages from depending on higher-level implementations', async () => {
    const packages = await listWorkspacePackages();
    const violations: string[] = [];

    for (const pkg of packages) {
      const forbidden = forbiddenByPackage[pkg.name] ?? [];

      if (!forbidden.length) {
        continue;
      }

      const dependencies = Object.keys(pkg.packageJson.dependencies ?? {});

      for (const dependency of dependencies) {
        if (forbidden.includes(dependency)) {
          violations.push(`${pkg.name} package.json depends on forbidden package ${dependency}`);
        }
      }

      const sourceFiles = await walkSourceFiles(join(pkg.dir, 'src'));

      for (const file of sourceFiles) {
        const content = await readFile(file, 'utf8');
        const imports = findWorkspaceImports(content);

        for (const imported of imports) {
          if (forbidden.includes(imported)) {
            violations.push(`${relative(repoRoot, file)} imports forbidden package ${imported}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

async function listWorkspacePackages(): Promise<WorkspacePackage[]> {
  const entries = await readdir(packagesRoot, { withFileTypes: true });
  const packages: WorkspacePackage[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const dir = join(packagesRoot, entry.name);
    const packageJson = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as PackageJson;

    packages.push({
      dir,
      name: packageJson.name,
      packageJson
    });
  }

  return packages;
}

async function walkSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walkSourceFiles(path)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.includes('.test.')) {
      files.push(path);
    }
  }

  return files;
}

function findWorkspaceImports(content: string): string[] {
  return [...content.matchAll(/['"](@mcp-dev-mesh\/[^'"]+)['"]/g)].map((match) => match[1]).filter(isString);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

interface WorkspacePackage {
  dir: string;
  name: string;
  packageJson: PackageJson;
}

interface PackageJson {
  name: string;
  dependencies?: Record<string, string>;
}
