/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', '"Inter"', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', '"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        obsidian: {
          950: '#04060d',
          900: '#070b16',
          850: '#0c1222',
          800: '#111a2e',
          700: '#1a2744',
        },
        brand: {
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          200: 'rgb(var(--brand-200) / <alpha-value>)',
          300: 'rgb(var(--brand-300) / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
        },
        accent: {
          100: 'rgb(var(--accent-100) / <alpha-value>)',
          200: 'rgb(var(--accent-200) / <alpha-value>)',
          300: 'rgb(var(--accent-300) / <alpha-value>)',
          400: 'rgb(var(--accent-400) / <alpha-value>)',
          500: 'rgb(var(--accent-500) / <alpha-value>)',
          600: 'rgb(var(--accent-600) / <alpha-value>)',
        },
      },
      boxShadow: {
        glow: '0 0 28px -6px rgb(var(--brand-400) / 0.42)',
        'glow-emerald': '0 0 28px -6px rgba(16, 185, 129, 0.45)',
        'glow-accent': '0 0 28px -6px rgb(var(--accent-500) / 0.44)',
        glass: '0 8px 32px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
      },
      keyframes: {
        'pulse-slow': {
          '0%, 100%': { opacity: '0.35', transform: 'scale(1)' },
          '50%': { opacity: '0.62', transform: 'scale(1.06)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'flash-up': {
          '0%': { backgroundColor: 'rgba(16, 185, 129, 0.38)', boxShadow: '0 0 18px rgba(16, 185, 129, 0.5)' },
          '100%': { backgroundColor: 'transparent', boxShadow: 'none' },
        },
        'flash-down': {
          '0%': { backgroundColor: 'rgba(244, 63, 94, 0.38)', boxShadow: '0 0 18px rgba(244, 63, 94, 0.5)' },
          '100%': { backgroundColor: 'transparent', boxShadow: 'none' },
        },
      },
      animation: {
        'pulse-slow': 'pulse-slow 9s ease-in-out infinite',
        shimmer: 'shimmer 2.4s linear infinite',
        'flash-up': 'flash-up 1.5s ease-out',
        'flash-down': 'flash-down 1.5s ease-out',
      },
    },
  },
  plugins: [],
};
