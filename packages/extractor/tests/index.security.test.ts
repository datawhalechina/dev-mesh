import { describe, expect, it } from 'vitest';
import { createSecretRedactor, redactText, scanText } from '../src/index.js';

describe('secret redactor', () => {
  it('redacts authorization headers, cookies, URL tokens, env secrets, private keys, and sensitive paths', async () => {
    const redactor = createSecretRedactor();
    const input = [
      'Authorization: Bearer abc.def.secret',
      'Cookie: sessionid=abc123; csrftoken=def456',
      'https://example.test/callback?access_token=secret-token&ok=true',
      'DATABASE_PASSWORD=super-secret',
      '-----BEGIN PRIVATE KEY-----',
      'very-secret-key-material',
      '-----END PRIVATE KEY-----',
      'Read .env.local and certs/server.pem before sync.'
    ].join('\n');

    const result = await redactor.redact({ text: input });

    expect(result.findings.map((finding) => finding.label)).toEqual([
      'authorization',
      'cookie',
      'url-token',
      'env-secret',
      'private-key',
      'sensitive-path',
      'sensitive-path'
    ]);
    expect(result.text).toContain('Authorization: Bearer [REDACTED:authorization]');
    expect(result.text).toContain('Cookie: [REDACTED:cookie]');
    expect(result.text).toContain('access_token=[REDACTED:url-token]');
    expect(result.text).toContain('DATABASE_PASSWORD=[REDACTED:env-secret]');
    expect(result.text).toContain('[REDACTED:private-key]');
    expect(result.text).toContain('Read [REDACTED:sensitive-path] and [REDACTED:sensitive-path] before sync.');
    expect(result.text).not.toContain('abc.def.secret');
    expect(result.text).not.toContain('super-secret');
    expect(result.text).not.toContain('very-secret-key-material');
  });

  it('exposes pure scan and redact helpers', () => {
    const input = 'Authorization: Basic dXNlcjpwYXNz';
    const findings = scanText(input);
    const result = redactText(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'credential',
      severity: 'high',
      label: 'authorization'
    });
    expect(result.text).toBe('Authorization: Basic [REDACTED:authorization]');
  });

  it('merges overlapping findings without duplicating replacement spans', () => {
    const input = 'API_TOKEN=sk_test_redacted_example';
    const result = redactText(input);

    expect(result.findings).toHaveLength(1);
    expect(result.text).toBe('API_TOKEN=[REDACTED:env-secret]');
  });
});
