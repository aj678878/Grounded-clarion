import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        headline: ['var(--font-merriweather)', 'Georgia', 'serif'],
        body: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      colors: {
        primary: {
          DEFAULT: '#1B3A5C',
          light: '#2A5A8C',
          dark: '#0F2440',
        },
      },
      maxWidth: {
        article: '72ch',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};

export default config;
