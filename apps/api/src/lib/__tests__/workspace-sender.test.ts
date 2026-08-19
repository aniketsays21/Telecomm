import { describe, it, expect } from 'vitest';
import { resolveWorkspaceSender } from '../workspace-email.js';

describe('workspace sender resolution', () => {
  it('prefers the explicitly verified sender signature', () => {
    const sender = resolveWorkspaceSender({
      name: 'Brand B',
      settings: { smtpFromAddress: 'support@brandb.com', supportEmail: 'help@brandb.com' },
    });
    expect(sender.from).toBe('support@brandb.com');
  });

  it('falls back to the onboarding support address so brands send branded by default', () => {
    const sender = resolveWorkspaceSender({
      name: 'Brand B',
      settings: { supportEmail: 'help@brandb.com' },
    });
    expect(sender.from).toBe('help@brandb.com');
  });

  it('uses the workspace name as the display name', () => {
    const sender = resolveWorkspaceSender({
      name: 'Brand B',
      settings: { smtpFromAddress: 'support@brandb.com' },
    });
    expect(sender.fromName).toBe('Brand B');
  });

  it('lets settings override the display name', () => {
    const sender = resolveWorkspaceSender({
      name: 'Brand B',
      settings: { smtpFromAddress: 'support@brandb.com', smtpFromName: 'Brand B Support' },
    });
    expect(sender.fromName).toBe('Brand B Support');
  });

  it('returns no sender when unconfigured, so the caller uses the platform default', () => {
    // Critical: never inherit another workspace's address.
    expect(resolveWorkspaceSender({ name: 'Brand B', settings: {} }).from).toBeUndefined();
    expect(resolveWorkspaceSender(null).from).toBeUndefined();
    expect(resolveWorkspaceSender({ name: 'Brand B' }).from).toBeUndefined();
  });

  it('ignores whitespace-only configuration', () => {
    const sender = resolveWorkspaceSender({
      name: 'Brand B',
      settings: { smtpFromAddress: '   ', supportEmail: '  ' },
    });
    expect(sender.from).toBeUndefined();
  });

  it('keeps two workspaces fully separate', () => {
    const a = resolveWorkspaceSender({ name: 'Brand A', settings: { smtpFromAddress: 'help@branda.com' } });
    const b = resolveWorkspaceSender({ name: 'Brand B', settings: { smtpFromAddress: 'support@brandb.com' } });
    expect(a.from).toBe('help@branda.com');
    expect(b.from).toBe('support@brandb.com');
  });
});
