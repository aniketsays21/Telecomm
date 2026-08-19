import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { verifyInboundWebhookAuth } from '../postmark-auth.js';

const ENV_KEYS = [
  'POSTMARK_WEBHOOK_USER',
  'POSTMARK_WEBHOOK_PASS',
  'POSTMARK_WEBHOOK_TOKEN',
  'NODE_ENV',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function req(headers: Record<string, string> = {}): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}

function basic(user: string, pass: string) {
  return { authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` };
}

describe('inbound webhook authentication — Basic', () => {
  beforeEach(() => {
    process.env.POSTMARK_WEBHOOK_USER = 'hook';
    process.env.POSTMARK_WEBHOOK_PASS = 's3cret';
  });

  it('accepts the configured credentials', () => {
    expect(verifyInboundWebhookAuth(req(basic('hook', 's3cret'))).ok).toBe(true);
  });

  it('rejects a wrong password', () => {
    const result = verifyInboundWebhookAuth(req(basic('hook', 'wrong')));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(401);
  });

  it('rejects a wrong user', () => {
    expect(verifyInboundWebhookAuth(req(basic('nope', 's3cret'))).ok).toBe(false);
  });

  it('rejects a missing Authorization header', () => {
    expect(verifyInboundWebhookAuth(req()).ok).toBe(false);
  });

  it('rejects a bearer token when Basic is configured', () => {
    expect(verifyInboundWebhookAuth(req({ authorization: 'Bearer s3cret' })).ok).toBe(false);
  });

  it('rejects malformed base64 and missing colon', () => {
    expect(verifyInboundWebhookAuth(req({ authorization: 'Basic !!!not-base64!!!' })).ok).toBe(false);
    const noColon = Buffer.from('hooksecret').toString('base64');
    expect(verifyInboundWebhookAuth(req({ authorization: `Basic ${noColon}` })).ok).toBe(false);
  });

  it('supports passwords containing colons', () => {
    process.env.POSTMARK_WEBHOOK_PASS = 'pa:ss:word';
    expect(verifyInboundWebhookAuth(req(basic('hook', 'pa:ss:word'))).ok).toBe(true);
  });

  it('is not fooled by a longer password sharing a prefix', () => {
    expect(verifyInboundWebhookAuth(req(basic('hook', 's3cretXXXX'))).ok).toBe(false);
    expect(verifyInboundWebhookAuth(req(basic('hook', 's3cre'))).ok).toBe(false);
  });
});

describe('inbound webhook authentication — token', () => {
  beforeEach(() => {
    process.env.POSTMARK_WEBHOOK_TOKEN = 'tok_abc';
  });

  it('accepts a bearer token', () => {
    expect(verifyInboundWebhookAuth(req({ authorization: 'Bearer tok_abc' })).ok).toBe(true);
  });

  it('accepts the custom header for proxies that strip Authorization', () => {
    expect(verifyInboundWebhookAuth(req({ 'x-webhook-token': 'tok_abc' })).ok).toBe(true);
  });

  it('rejects a wrong or missing token', () => {
    expect(verifyInboundWebhookAuth(req({ authorization: 'Bearer nope' })).ok).toBe(false);
    expect(verifyInboundWebhookAuth(req()).ok).toBe(false);
  });
});

describe('inbound webhook authentication — unconfigured', () => {
  it('refuses to serve an unauthenticated webhook in production', () => {
    process.env.NODE_ENV = 'production';
    const result = verifyInboundWebhookAuth(req());
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(500);
    expect(result.ok === false && result.reason).toMatch(/POSTMARK_WEBHOOK_USER/);
  });

  it('allows unauthenticated requests outside production so local testing works', () => {
    process.env.NODE_ENV = 'development';
    expect(verifyInboundWebhookAuth(req()).ok).toBe(true);
  });
});
