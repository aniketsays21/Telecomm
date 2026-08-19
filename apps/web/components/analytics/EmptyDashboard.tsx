import Link from 'next/link';

/**
 * Shown on the dashboard when a workspace has zero conversations yet — right
 * after publishing, before any chat or email has flowed through. The goal
 * isn't to fill the page with placeholder charts; it's to explain what will
 * live here once the platform has real data, and point to the two things
 * that make the first conversation happen.
 */
export function EmptyDashboard() {
  const stats: Array<{ label: string; hint: string }> = [
    { label: 'Total conversations', hint: 'Every chat and email that came in.' },
    { label: 'Open now', hint: 'What still needs someone.' },
    { label: 'Resolved', hint: 'Closed by an agent or the AI.' },
    { label: 'Escalation rate', hint: 'How often the AI hands off.' },
  ];

  return (
    <div className="space-y-14">
      {/* One-line pitch */}
      <section>
        <p
          className="font-display italic text-3xl leading-tight max-w-3xl"
          style={{ color: 'var(--ink)' }}
        >
          Telecomm turns your customer chats and emails into one calm inbox,
          answers the easy ones with AI, and hands the tricky ones to your team.
        </p>
      </section>

      {/* Ghost KPI row so admins can see the shape of what's coming */}
      <section>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8">
          {stats.map((s) => (
            <div key={s.label} className="py-5" style={{ borderTop: '1px solid var(--rule)' }}>
              <p className="eyebrow">{s.label}</p>
              <p
                className="font-display italic leading-none mt-3"
                style={{ color: 'var(--dust)', fontSize: '2.75rem' }}
              >
                —
              </p>
              <p className="text-xs mt-2" style={{ color: 'var(--dust)' }}>{s.hint}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Two next-steps + "where insights will live" panel, editorial layout */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-10">
        <div className="md:col-span-2 p-8" style={{ background: 'var(--paper)', border: '1px solid var(--rule)' }}>
          <p className="eyebrow mb-4">Waiting for your first conversation</p>
          <h3 className="font-display italic text-2xl mb-3" style={{ color: 'var(--ink)' }}>
            Once messages arrive, this page shows what your customers actually need.
          </h3>
          <ul className="space-y-3 mt-6">
            {[
              'A pie of chat vs email so you know where volume comes from.',
              'A day-by-day bar of what came in and what got escalated.',
              'The topics your customers keep asking about — sorted, tagged, and countable.',
              'Response time and resolution time so SLAs stop being a guess.',
            ].map((line) => (
              <li key={line} className="flex items-start gap-3">
                <span
                  className="w-1.5 h-1.5 rounded-full mt-2 shrink-0"
                  style={{ background: 'var(--forest)' }}
                />
                <span className="text-sm" style={{ color: 'var(--ink)' }}>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="p-8" style={{ background: 'var(--forest-soft)', border: '1px solid var(--rule)' }}>
          <p className="eyebrow mb-3" style={{ color: 'var(--forest)' }}>Do this next</p>
          <ol className="space-y-4 text-sm" style={{ color: 'var(--ink)' }}>
            <li>
              <Link href="/settings/gmail" className="font-medium underline underline-offset-4 hover:opacity-80">
                Add an email routing rule
              </Link>
              <p className="text-xs mt-1" style={{ color: 'var(--ash)' }}>
                Route the subjects you care about into the inbox.
              </p>
            </li>
            <li>
              <Link href="/settings/widget" className="font-medium underline underline-offset-4 hover:opacity-80">
                Install the chat widget
              </Link>
              <p className="text-xs mt-1" style={{ color: 'var(--ash)' }}>
                Paste one script tag on your site so visitors can start a chat.
              </p>
            </li>
            <li>
              <Link href="/settings/team" className="font-medium underline underline-offset-4 hover:opacity-80">
                Invite more teammates
              </Link>
              <p className="text-xs mt-1" style={{ color: 'var(--ash)' }}>
                Escalations route to whoever&apos;s on-duty.
              </p>
            </li>
          </ol>
        </div>
      </section>

      {/* Value strip — three quiet mini-stories to match the aesthetic */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {[
          {
            heading: 'One inbox',
            body: 'Chat, email, and every reply thread land in the same place. No more tab-hopping.',
          },
          {
            heading: 'AI does the easy ones',
            body: 'Your knowledge base powers instant answers to the questions you get every day.',
          },
          {
            heading: 'Humans do the rest',
            body: 'When the AI is unsure, it hands the thread to the agent who&apos;s free right now.',
          },
        ].map((c) => (
          <div key={c.heading} className="pt-5" style={{ borderTop: '1px solid var(--rule)' }}>
            <p className="font-display italic text-xl" style={{ color: 'var(--ink)' }}>
              {c.heading}
            </p>
            <p className="text-sm mt-2" style={{ color: 'var(--ash)' }}
               dangerouslySetInnerHTML={{ __html: c.body }} />
          </div>
        ))}
      </section>
    </div>
  );
}
