import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

/**
 * Typography — single sans family (Inter) sized in a clear scale. Inter is
 * the safe, corporate-legible default; readable at every size, wide language
 * coverage, and never mistaken for "AI-generated look". Numeric readouts use
 * JetBrains Mono for aligned columns; nothing italic in the display font.
 */
const sans = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Telecomm',
  description: 'AI Customer Communication Platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // --font-serif kept as an alias pointing at sans so any lingering
    // `font-display` classes fall back to the Inter stack instead of the
    // browser's default serif. Prevents a jarring theme while we finish
    // sweeping the codebase.
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable}`}
      style={{ ['--font-serif' as string]: 'var(--font-sans)' }}
    >
      <body className="antialiased">{children}</body>
    </html>
  );
}
