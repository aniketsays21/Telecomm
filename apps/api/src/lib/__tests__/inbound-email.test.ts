import { describe, it, expect } from 'vitest';
import {
  parseHeaders,
  headerValue,
  normalizeAddress,
  stripPlusTag,
  extractRecipients,
  extractFrom,
  extractMessageId,
  extractInReplyTo,
  extractReferences,
  threadCandidates,
  detectAutomated,
  cleanSubject,
  buildReferences,
} from '../inbound-email.js';
import { normalizeMessageId, bracketMessageId, buildOutboundMessageId } from '../mailer.js';

/** A Postmark inbound payload for mail forwarded from a brand's own mailbox. */
function postmarkPayload(overrides: Record<string, any> = {}) {
  return {
    From: 'Alice <Alice@Example.COM>',
    FromFull: { Email: 'Alice@Example.COM', Name: 'Alice' },
    To: 'Support <Help@TheBrand.com>',
    ToFull: [{ Email: 'Help@TheBrand.com', Name: 'Support' }],
    OriginalRecipient: 'inbound-hash@inbound.postmarkapp.com',
    Subject: 'Re: Where is my order?',
    TextBody: 'Any update?',
    MessageID: 'abc-123@example.com',
    Headers: [
      { Name: 'In-Reply-To', Value: '<outbound-1@thebrand.com>' },
      { Name: 'References', Value: '<root-0@example.com> <outbound-1@thebrand.com>' },
    ],
    ...overrides,
  };
}

describe('Message-ID normalization', () => {
  it('strips angle brackets so header and payload forms compare equal', () => {
    // Postmark's MessageID field is bare; the raw header is bracketed.
    expect(normalizeMessageId('<abc@x.com>')).toBe('abc@x.com');
    expect(normalizeMessageId('abc@x.com')).toBe('abc@x.com');
    expect(normalizeMessageId('  <abc@x.com>  ')).toBe('abc@x.com');
  });

  it('treats empty and missing values as undefined', () => {
    expect(normalizeMessageId(undefined)).toBeUndefined();
    expect(normalizeMessageId('')).toBeUndefined();
    expect(normalizeMessageId('<>')).toBeUndefined();
  });

  it('re-adds brackets only when writing a header', () => {
    expect(bracketMessageId('abc@x.com')).toBe('<abc@x.com>');
    expect(bracketMessageId('<abc@x.com>')).toBe('<abc@x.com>');
    expect(bracketMessageId(undefined)).toBeUndefined();
  });

  it('generates an outbound id on the sending domain', () => {
    const id = buildOutboundMessageId('help@thebrand.com');
    expect(id.endsWith('@thebrand.com')).toBe(true);
    expect(buildOutboundMessageId('help@thebrand.com')).not.toBe(id);
  });
});

describe('address normalization', () => {
  it('unwraps display names and lower-cases', () => {
    expect(normalizeAddress('Support <Help@Brand.COM>')).toBe('help@brand.com');
    expect(normalizeAddress('  HELP@BRAND.com ')).toBe('help@brand.com');
    expect(normalizeAddress('"Doe, Jane" <jane@x.com>')).toBe('jane@x.com');
  });

  it('rejects values that are not addresses', () => {
    expect(normalizeAddress('not an address')).toBeUndefined();
    expect(normalizeAddress('')).toBeUndefined();
    expect(normalizeAddress(undefined)).toBeUndefined();
  });

  it('strips plus tags for sub-addressed routing', () => {
    expect(stripPlusTag('help+order99@brand.com')).toBe('help@brand.com');
    expect(stripPlusTag('help@brand.com')).toBeUndefined();
  });
});

describe('recipient extraction (workspace routing key)', () => {
  it('keeps the brand address when mail was forwarded through Postmark', () => {
    // OriginalRecipient is Postmark's own inbound address for forwarded mail,
    // so the brand address must still be found via To.
    const recipients = extractRecipients(postmarkPayload());
    expect(recipients[0]).toBe('inbound-hash@inbound.postmarkapp.com');
    expect(recipients).toContain('help@thebrand.com');
  });

  it('prefers the envelope recipient when mail was MX-routed directly', () => {
    const recipients = extractRecipients(
      postmarkPayload({ OriginalRecipient: 'help@thebrand.com' }),
    );
    expect(recipients[0]).toBe('help@thebrand.com');
  });

  it('picks up forwarding headers', () => {
    const recipients = extractRecipients(
      postmarkPayload({
        OriginalRecipient: undefined,
        Headers: [{ Name: 'Delivered-To', Value: 'help@thebrand.com' }],
      }),
    );
    expect(recipients[0]).toBe('help@thebrand.com');
  });

  it('includes the plus-stripped form as a routing candidate', () => {
    const recipients = extractRecipients(
      postmarkPayload({ OriginalRecipient: 'help+order99@thebrand.com' }),
    );
    expect(recipients).toContain('help+order99@thebrand.com');
    expect(recipients).toContain('help@thebrand.com');
  });

  it('splits comma-separated lists without breaking quoted display names', () => {
    const recipients = extractRecipients({
      To: '"Doe, Jane" <jane@x.com>, help@thebrand.com',
    });
    expect(recipients).toContain('jane@x.com');
    expect(recipients).toContain('help@thebrand.com');
  });

  it('includes Cc so mail merely copied to support still routes', () => {
    const recipients = extractRecipients({
      To: 'someone@else.com',
      Cc: 'help@thebrand.com',
    });
    expect(recipients).toContain('help@thebrand.com');
  });

  it('deduplicates repeated addresses', () => {
    const recipients = extractRecipients({
      OriginalRecipient: 'help@thebrand.com',
      To: 'Help@TheBrand.com',
      ToFull: [{ Email: 'HELP@thebrand.com' }],
    });
    expect(recipients.filter((r) => r === 'help@thebrand.com')).toHaveLength(1);
  });
});

describe('header and thread parsing', () => {
  it('reads In-Reply-To from the Postmark Headers array', () => {
    const raw = postmarkPayload();
    expect(extractInReplyTo(raw)).toBe('outbound-1@thebrand.com');
  });

  it('parses the References chain into bare ids', () => {
    expect(extractReferences(postmarkPayload())).toEqual([
      'root-0@example.com',
      'outbound-1@thebrand.com',
    ]);
  });

  it('orders thread candidates most-specific first', () => {
    // In-Reply-To names the direct parent; References walks back up the thread.
    expect(threadCandidates(postmarkPayload())).toEqual([
      'outbound-1@thebrand.com',
      'root-0@example.com',
    ]);
  });

  it('extracts the inbound Message-ID and sender', () => {
    const raw = postmarkPayload();
    expect(extractMessageId(raw)).toBe('abc-123@example.com');
    expect(extractFrom(raw)).toBe('alice@example.com');
  });

  it('is case-insensitive on header names', () => {
    const headers = parseHeaders({ Headers: [{ Name: 'AUTO-SUBMITTED', Value: 'auto-replied' }] });
    expect(headerValue(headers, 'Auto-Submitted')).toBe('auto-replied');
  });

  it('falls back to top-level fields for non-Postmark providers', () => {
    const raw = { from: 'bob@x.com', messageId: '<m1@x.com>', 'In-Reply-To': '<m0@x.com>' };
    expect(extractFrom(raw)).toBe('bob@x.com');
    expect(extractMessageId(raw)).toBe('m1@x.com');
    expect(extractInReplyTo(raw)).toBe('m0@x.com');
  });
});

describe('auto-reply loop protection', () => {
  const automated = (headers: Array<{ Name: string; Value: string }>, extra = {}) =>
    detectAutomated(postmarkPayload({ Headers: headers, ...extra }));

  it('flags RFC 3834 Auto-Submitted', () => {
    expect(automated([{ Name: 'Auto-Submitted', Value: 'auto-replied' }]).automated).toBe(true);
    expect(automated([{ Name: 'Auto-Submitted', Value: 'auto-generated' }]).automated).toBe(true);
  });

  it('allows Auto-Submitted: no, which marks genuine human mail', () => {
    expect(automated([{ Name: 'Auto-Submitted', Value: 'no' }]).automated).toBe(false);
  });

  it('flags bulk and list precedence', () => {
    expect(automated([{ Name: 'Precedence', Value: 'bulk' }]).automated).toBe(true);
    expect(automated([{ Name: 'Precedence', Value: 'list' }]).automated).toBe(true);
  });

  it('flags mailing lists', () => {
    expect(automated([{ Name: 'List-Id', Value: '<list.example.com>' }]).automated).toBe(true);
    expect(automated([{ Name: 'List-Unsubscribe', Value: '<mailto:x@y.com>' }]).automated).toBe(true);
  });

  it('honours an explicit suppression request', () => {
    expect(automated([{ Name: 'X-Auto-Response-Suppress', Value: 'All' }]).automated).toBe(true);
  });

  it('flags a null Return-Path as a bounce', () => {
    expect(automated([{ Name: 'Return-Path', Value: '<>' }]).automated).toBe(true);
  });

  it('flags no-reply and daemon senders', () => {
    for (const sender of ['no-reply@x.com', 'noreply@x.com', 'MAILER-DAEMON@x.com', 'postmaster@x.com']) {
      const check = detectAutomated(
        postmarkPayload({ From: sender, FromFull: { Email: sender }, Headers: [] }),
      );
      expect(check.automated, sender).toBe(true);
    }
  });

  it('lets ordinary customer mail through', () => {
    expect(detectAutomated(postmarkPayload({ Headers: [] })).automated).toBe(false);
  });
});

describe('subject and reference building', () => {
  it('strips stacked Re:/Fwd: prefixes', () => {
    expect(cleanSubject('Re: Re: Fwd: Order status')).toBe('Order status');
    expect(cleanSubject('Order status')).toBe('Order status');
    expect(cleanSubject('Re:')).toBe('(no subject)');
  });

  it('appends the parent id and deduplicates the chain', () => {
    expect(buildReferences(['root@x.com', 'mid@x.com'], 'leaf@x.com')).toBe(
      'root@x.com mid@x.com leaf@x.com',
    );
    expect(buildReferences(['root@x.com'], 'root@x.com')).toBe('root@x.com');
    expect(buildReferences([], undefined)).toBeUndefined();
  });

  it('normalizes bracketed ids into the chain', () => {
    expect(buildReferences(['<root@x.com>'], '<leaf@x.com>')).toBe('root@x.com leaf@x.com');
  });
});
