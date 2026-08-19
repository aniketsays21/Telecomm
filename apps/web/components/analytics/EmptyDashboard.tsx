import Link from 'next/link';

/**
 * Zero-conversation state. Deliberately spare: one line of value prop, a
 * ghost KPI row so the shape is legible, and the two next-actions that
 * make the first conversation happen. Everything else lives elsewhere.
 */
export function EmptyDashboard() {
  const stats = ['Total conversations', 'Open now', 'Resolved', 'Escalation rate'];

  return (
    <div className="space-y-12">
      <section>
        <p className="text-lg leading-snug max-w-3xl" style={{ color: 'var(--ash)' }}>
          Every chat and email in one inbox — the AI handles what it can, your team handles the rest.
        </p>
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-x-8">
        {stats.map((label) => (
          <div key={label} className="py-4" style={{ borderTop: '1px solid var(--rule)' }}>
            <p className="eyebrow">{label}</p>
            <p
              className="font-display leading-none mt-3"
              style={{ color: 'var(--dust)', fontSize: '2rem' }}
            >
              —
            </p>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link
          href="/settings/gmail"
          className="p-5 rounded-lg border transition-colors group"
          style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
        >
          <p className="eyebrow mb-2" style={{ color: 'var(--forest)' }}>Step 1</p>
          <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Add an email routing rule →</p>
          <p className="text-xs mt-1" style={{ color: 'var(--ash)' }}>
            Route the subjects you care about into the inbox.
          </p>
        </Link>
        <Link
          href="/settings/widget"
          className="p-5 rounded-lg border transition-colors group"
          style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
        >
          <p className="eyebrow mb-2" style={{ color: 'var(--forest)' }}>Step 2</p>
          <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Install the chat widget →</p>
          <p className="text-xs mt-1" style={{ color: 'var(--ash)' }}>
            One script tag on your site — visitors can chat instantly.
          </p>
        </Link>
      </section>
    </div>
  );
}
