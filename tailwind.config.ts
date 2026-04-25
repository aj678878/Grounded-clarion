import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        headline: ['var(--font-playfair)', 'Playfair Display', 'Georgia', 'serif'],
        body: ['var(--font-baskerville)', 'Libre Baskerville', 'Georgia', 'serif'],
        ui: ['var(--font-source-sans)', 'Source Sans 3', 'system-ui', 'sans-serif'],
      },
      colors: {
        paper: 'var(--paper)',
        'paper-alt': 'var(--paper-alt)',
        'paper-card': 'var(--paper-card)',
        ink: 'var(--ink)',
        'ink-2': 'var(--ink-2)',
        'ink-3': 'var(--ink-3)',
        accent: 'var(--accent)',
        'accent-soft': 'var(--accent)',
        red: 'var(--red)',
        border: 'var(--border)',
        'col-rule': 'var(--col-rule)',
        // legacy alias kept for any straggling references
        primary: {
          DEFAULT: 'var(--accent)',
          light: 'var(--accent)',
          dark: 'var(--accent)',
        },
      },
      maxWidth: {
        article: '680px',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};

export default config;
