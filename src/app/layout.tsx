import type { Metadata } from 'next';
import { Playfair_Display, Libre_Baskerville, Source_Sans_3 } from 'next/font/google';
import './globals.css';

const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['400', '700', '900'],
  style: ['normal', 'italic'],
  variable: '--font-playfair',
  display: 'swap',
});

const baskerville = Libre_Baskerville({
  subsets: ['latin'],
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  variable: '--font-baskerville',
  display: 'swap',
});

const sourceSans = Source_Sans_3({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-source-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Clarion — Truth, Clearly Told',
  description:
    'Clarion is a broadsheet-style news reader with an AI editor that answers questions about the article you are reading.',
};

// Inline pre-paint script to set the data-dark attribute before first render,
// avoiding a flash of light theme for users with dark mode enabled.
const darkModeBoot = `
(function () {
  try {
    var stored = localStorage.getItem('clarion-theme');
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var dark = stored === 'dark' || (stored === null && prefersDark);
    if (dark) document.documentElement.setAttribute('data-dark', 'true');
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${playfair.variable} ${baskerville.variable} ${sourceSans.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: darkModeBoot }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
