import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliPackageDir = join(repoRoot, 'apps', 'dmx');
const cliPackage = JSON.parse(await readFile(join(cliPackageDir, 'package.json'), 'utf8'));
const options = readOptions(process.argv.slice(2));
const tempRoot = await mkdtemp(join(tmpdir(), 'devmesh-npm-smoke-'));

try {
  if (!options.skipBuild) {
    await run(commandName('pnpm'), ['--filter', 'devmesh', 'build'], { cwd: repoRoot });
  }

  const prefix = join(tempRoot, 'prefix');
  const projectRoot = join(tempRoot, 'project');
  const globalRoot = join(tempRoot, 'global');

  await mkdir(prefix, { recursive: true });
  await mkdir(projectRoot, { recursive: true });
  await mkdir(globalRoot, { recursive: true });

  const pack = await run(commandName('npm'), ['pack', '--pack-destination', tempRoot, '--json'], {
    cwd: cliPackageDir
  });
  const packed = JSON.parse(pack.stdout);
  const tarball = join(tempRoot, packed[0].filename);

  await run(commandName('npm'), ['install', '-g', tarball, '--prefix', prefix], { cwd: repoRoot });

  const dmx = resolveDmxBin(prefix);
  const env = {
    ...process.env,
    CI: '1',
    DEV_MESH_HOME: globalRoot,
    NO_COLOR: '1'
  };

  const version = (await run(dmx, ['--version'], { cwd: repoRoot, env })).stdout.trim();

  assertEqual(version, cliPackage.version, 'installed dmx version');

  const init = await run(
    dmx,
    ['init', '--project', '--root', projectRoot, '--name', 'Smoke', '--yes', '--json'],
    { cwd: repoRoot, env }
  );
  const initJson = parseJson(init.stdout, 'dmx init --json');

  assertEqual(initJson.storeRoot, join(projectRoot, '.dev-mesh'), 'init storeRoot');

  const statusText = await run(dmx, ['status', '--root', projectRoot], { cwd: repoRoot, env });

  assertIncludes(statusText.stdout, 'DevMesh status', 'dmx status text');
  assertNotJson(statusText.stdout, 'dmx status text');

  const statusJson = parseJson(
    (await run(dmx, ['status', '--root', projectRoot, '--json'], { cwd: repoRoot, env })).stdout,
    'dmx status --json'
  );

  assertEqual(statusJson.mode, 'local-only', 'status mode');

  const capture = parseJson(
    (
      await run(
        dmx,
        [
          'capture',
          '--root',
          projectRoot,
          '--title',
          'Packaged CLI smoke',
          '--summary',
          'The packaged CLI can capture and search project knowledge.',
          '--type',
          'decision',
          '--json'
        ],
        { cwd: repoRoot, env }
      )
    ).stdout,
    'dmx capture --json'
  );

  assertEqual(capture.title, 'Packaged CLI smoke', 'capture title');

  const searchText = await run(dmx, ['search', 'Packaged CLI smoke', '--root', projectRoot], {
    cwd: repoRoot,
    env
  });

  assertIncludes(searchText.stdout, 'DevMesh context results', 'dmx search text');
  assertIncludes(searchText.stdout, `id=${capture.id}`, 'dmx search captured id');
  assertNotJson(searchText.stdout, 'dmx search text');

  const graphText = await run(dmx, ['graph', 'edge', 'list', '--root', projectRoot], { cwd: repoRoot, env });

  assertIncludes(graphText.stdout, 'Knowledge graph edges', 'dmx graph edge list text');
  assertNotJson(graphText.stdout, 'dmx graph edge list text');

  console.log(`DevMesh npm package smoke check passed for ${cliPackage.name}@${cliPackage.version}.`);
} finally {
  if (options.keepTemp) {
    console.log(`Kept npm smoke temp directory: ${tempRoot}`);
  } else {
    await removeTempRoot(tempRoot);
  }
}

function readOptions(args) {
  return {
    keepTemp: args.includes('--keep-temp'),
    skipBuild: args.includes('--skip-build')
  };
}

function commandName(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

function resolveDmxBin(prefix) {
  return process.platform === 'win32' ? join(prefix, 'dmx.cmd') : join(prefix, 'bin', 'dmx');
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const useShell = process.platform === 'win32';
    const child = spawn(useShell ? createShellCommand(command, args) : command, useShell ? [] : args, {
      cwd: options.cwd,
      env: options.env,
      shell: useShell,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolveRun({ stdout, stderr });
        return;
      }

      reject(new Error(formatCommandFailure(command, args, code, stdout, stderr)));
    });
  });
}

function createShellCommand(command, args) {
  return [command, ...args].map(quoteWindowsShellArg).join(' ');
}

function quoteWindowsShellArg(value) {
  const text = String(value);

  if (/^[A-Za-z0-9_./:=+-]+$/.test(text)) {
    return text;
  }

  return `"${text.replace(/(["^&|<>%])/g, '^$1')}"`;
}

function formatCommandFailure(command, args, code, stdout, stderr) {
  return [
    `Command failed with exit code ${code}: ${command} ${args.join(' ')}`,
    stdout.trim().length > 0 ? `stdout:\n${stdout.trim()}` : undefined,
    stderr.trim().length > 0 ? `stderr:\n${stderr.trim()}` : undefined
  ]
    .filter(Boolean)
    .join('\n');
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} did not return valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${expected}, received ${actual}`);
  }
}

function assertIncludes(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`${label} should include ${expected}`);
  }
}

function assertNotJson(value, label) {
  if (value.trimStart().startsWith('{') || value.trimStart().startsWith('[')) {
    throw new Error(`${label} should be readable text, not JSON`);
  }
}

async function removeTempRoot(path) {
  const resolved = resolve(path);
  const temp = resolve(tmpdir());

  if (resolved === temp || !resolved.startsWith(`${temp}${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error(`Refusing to remove unexpected temp path: ${path}`);
  }

  await rm(resolved, { recursive: true, force: true });
}
