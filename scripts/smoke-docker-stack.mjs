#!/usr/bin/env node

const DEFAULTS = {
  hubUrl: process.env.DEV_MESH_SMOKE_HUB_URL ?? 'http://127.0.0.1:8721',
  webAdminUrl: process.env.DEV_MESH_SMOKE_WEB_ADMIN_URL ?? 'http://127.0.0.1:5173',
  websiteUrl: process.env.DEV_MESH_SMOKE_WEBSITE_URL ?? 'http://127.0.0.1:3000',
  timeoutMs: readIntegerEnv('DEV_MESH_SMOKE_TIMEOUT_MS', 60_000),
  intervalMs: readIntegerEnv('DEV_MESH_SMOKE_INTERVAL_MS', 2_000),
  requestTimeoutMs: readIntegerEnv('DEV_MESH_SMOKE_REQUEST_TIMEOUT_MS', 5_000),
  json: false
};

try {
  const options = parseArgs(process.argv.slice(2), DEFAULTS);

  if (options.help) {
    printHelp();
  } else {
    const result = await waitForStack(options);

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printResult(result);
    }

    if (!result.ok) {
      process.exitCode = 1;
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function waitForStack(options) {
  const startedAt = Date.now();
  const deadline = startedAt + options.timeoutMs;
  const checks = createChecks(options);
  let lastResults = [];

  do {
    lastResults = await Promise.all(checks.map((check) => runCheck(check, options.requestTimeoutMs)));

    if (lastResults.every((result) => result.ok)) {
      return {
        ok: true,
        elapsedMs: Date.now() - startedAt,
        checks: lastResults
      };
    }

    if (Date.now() >= deadline) {
      break;
    }

    await delay(Math.min(options.intervalMs, Math.max(deadline - Date.now(), 0)));
  } while (Date.now() <= deadline);

  return {
    ok: false,
    elapsedMs: Date.now() - startedAt,
    checks: lastResults
  };
}

function createChecks(options) {
  return [
    {
      name: 'Hub health',
      url: joinUrl(options.hubUrl, '/healthz'),
      async probe(url, requestTimeoutMs) {
        const response = await requestText(url, requestTimeoutMs);

        if (!response.ok) {
          return fail(response, `expected 2xx, received ${response.status}`);
        }

        const body = parseJson(response.body);

        if (body.status !== 'ok' || body.service !== 'devmesh') {
          return fail(response, 'unexpected health response body');
        }

        return pass(response, 'healthy');
      }
    },
    {
      name: 'Hub discovery',
      url: joinUrl(options.hubUrl, '/.well-known/devmesh'),
      async probe(url, requestTimeoutMs) {
        const response = await requestText(url, requestTimeoutMs);

        if (!response.ok) {
          return fail(response, `expected 2xx, received ${response.status}`);
        }

        const body = parseJson(response.body);
        const expectedMcpUrl = joinUrl(options.hubUrl, '/mcp');

        if (body.serverName !== 'DevMesh' || body.mcpUrl !== expectedMcpUrl) {
          return fail(response, 'unexpected discovery response body');
        }

        return pass(response, 'discovery ok');
      }
    },
    {
      name: 'Web Admin shell',
      url: options.webAdminUrl,
      async probe(url, requestTimeoutMs) {
        const response = await requestText(url, requestTimeoutMs);

        if (!response.ok) {
          return fail(response, `expected 2xx, received ${response.status}`);
        }

        if (!response.body.includes('<div id="app">')) {
          return fail(response, 'expected Vue app shell markup');
        }

        return pass(response, 'static shell ok');
      }
    },
    {
      name: 'Web Admin proxy health',
      url: joinUrl(options.webAdminUrl, '/healthz'),
      async probe(url, requestTimeoutMs) {
        const response = await requestText(url, requestTimeoutMs);

        if (!response.ok) {
          return fail(response, `expected 2xx, received ${response.status}`);
        }

        const body = parseJson(response.body);

        if (body.status !== 'ok' || body.service !== 'devmesh') {
          return fail(response, 'unexpected proxied health response body');
        }

        return pass(response, 'proxy ok');
      }
    },
    {
      name: 'Website home',
      url: options.websiteUrl,
      async probe(url, requestTimeoutMs) {
        const response = await requestText(url, requestTimeoutMs);

        if (!response.ok) {
          return fail(response, `expected 2xx, received ${response.status}`);
        }

        if (!response.body.includes('DevMesh')) {
          return fail(response, 'expected website brand text');
        }

        return pass(response, 'website ok');
      }
    }
  ];
}

async function runCheck(check, requestTimeoutMs) {
  try {
    const result = await check.probe(check.url, requestTimeoutMs);

    return {
      name: check.name,
      url: check.url,
      ...result
    };
  } catch (error) {
    return {
      name: check.name,
      url: check.url,
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

async function requestText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal
    });

    return {
      ok: response.ok,
      status: response.status,
      body: await response.text()
    };
  } finally {
    clearTimeout(timer);
  }
}

function pass(response, message) {
  return {
    ok: true,
    status: response.status,
    message
  };
}

function fail(response, message) {
  return {
    ok: false,
    status: response.status,
    message
  };
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('response body is not valid JSON');
  }
}

function joinUrl(baseUrl, path) {
  const url = new URL(path, `${normalizeBaseUrl(baseUrl)}/`);

  return url.toString().replace(/\/$/, '');
}

function normalizeBaseUrl(value) {
  const url = new URL(value);

  return url.toString().replace(/\/$/, '');
}

function parseArgs(args, defaults) {
  const options = {
    ...defaults,
    hubUrl: normalizeBaseUrl(defaults.hubUrl),
    webAdminUrl: normalizeBaseUrl(defaults.webAdminUrl),
    websiteUrl: normalizeBaseUrl(defaults.websiteUrl)
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--json') {
      options.json = true;
      continue;
    }

    const separator = arg.indexOf('=');
    const key = separator === -1 ? arg : arg.slice(0, separator);
    const inlineValue = separator === -1 ? undefined : arg.slice(separator + 1);
    const value = inlineValue ?? args[index + 1];

    if (value === undefined) {
      throw new Error(`Missing value for ${arg}`);
    }

    switch (key) {
      case '--hub-url':
        options.hubUrl = normalizeBaseUrl(value);
        break;
      case '--web-admin-url':
        options.webAdminUrl = normalizeBaseUrl(value);
        break;
      case '--website-url':
        options.websiteUrl = normalizeBaseUrl(value);
        break;
      case '--timeout-ms':
        options.timeoutMs = parsePositiveInteger(value, key);
        break;
      case '--interval-ms':
        options.intervalMs = parsePositiveInteger(value, key);
        break;
      case '--request-timeout-ms':
        options.requestTimeoutMs = parsePositiveInteger(value, key);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }

    if (inlineValue === undefined) {
      index += 1;
    }
  }

  return options;
}

function parsePositiveInteger(value, name) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function readIntegerEnv(name, fallback) {
  const value = process.env[name];

  return value === undefined || value.trim() === '' ? fallback : parsePositiveInteger(value, name);
}

function printResult(result) {
  const status = result.ok ? 'passed' : 'failed';

  console.log(`DevMesh Docker stack smoke check ${status} in ${formatDuration(result.elapsedMs)}.`);

  for (const check of result.checks) {
    const marker = check.ok ? 'OK' : 'FAIL';
    const statusCode = check.status === undefined ? '' : ` (${check.status})`;

    console.log(`- ${marker} ${check.name}: ${check.url}${statusCode} - ${check.message}`);
  }

  if (!result.ok) {
    console.log('Tip: start the stack first with pnpm docker:up:detached.');
  }
}

function printHelp() {
  console.log(`Usage: node scripts/smoke-docker-stack.mjs [options]

Checks the local alpha Docker Compose stack.

Options:
  --hub-url <url>              Hub Server base URL. Default: ${DEFAULTS.hubUrl}
  --web-admin-url <url>        Web Admin base URL. Default: ${DEFAULTS.webAdminUrl}
  --website-url <url>          Website base URL. Default: ${DEFAULTS.websiteUrl}
  --timeout-ms <number>        Overall wait timeout. Default: ${DEFAULTS.timeoutMs}
  --interval-ms <number>       Retry interval. Default: ${DEFAULTS.intervalMs}
  --request-timeout-ms <num>   Per-request timeout. Default: ${DEFAULTS.requestTimeoutMs}
  --json                       Print machine-readable JSON.
  -h, --help                   Show this help.

Environment:
  DEV_MESH_SMOKE_HUB_URL
  DEV_MESH_SMOKE_WEB_ADMIN_URL
  DEV_MESH_SMOKE_WEBSITE_URL
  DEV_MESH_SMOKE_TIMEOUT_MS
  DEV_MESH_SMOKE_INTERVAL_MS
  DEV_MESH_SMOKE_REQUEST_TIMEOUT_MS`);
}

function formatDuration(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
