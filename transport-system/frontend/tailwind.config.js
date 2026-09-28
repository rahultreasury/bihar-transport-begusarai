/**
 * tailwind.config.js
 * ---------------------------------------------------------------------------
 * THE SINGLE SOURCE OF TRUTH FOR THE BIHAR TRANSPORT DESIGN SYSTEM.
 *
 * WHY THIS FILE, AND NOT 25 PAGES
 * The admin console is ~30 pages and hundreds of thousands of lines of JSX that
 * already use Tailwind colour utilities (`bg-amber-500`, `text-gray-900`,
 * `border-gray-200`, …). The Enquiry page is the master visual reference, so
 * instead of hunting down every hard-coded colour we re-point the PALETTE ITSELF
 * at the brand tokens. One edit here re-skins the entire console coherently,
 * with zero `!important`, zero per-page churn and zero functional risk.
 *
 * The master palette is defined in `src/index.css` as `--bt-*` custom
 * properties; the raw values below are duplicated deliberately so Tailwind can
 * generate static classes (a `var()` inside `theme.colors` is not statically
 * analysable for every utility). Keep the two in sync — the comments on each
 * scale name the token it mirrors.
 *
 * THE COLOUR RULE
 *   Navy + White + Soft Gray carry the interface.
 *   Orange is a small, deliberate accent only — buttons, active nav, focus.
 *   This is why the "cool" families (blue/slate/indigo) are pulled toward navy
 *   and the "warm" families (amber/orange) are pulled toward the brand orange:
 *   legacy code can keep using amber-500 or blue-800 and still land on-brand.
 */

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],

  /* The `bt-*` classes ARE the design system — cards, buttons, inputs, badges,
     tables, KPI tiles, states. They live in `@layer components` in index.css,
     which Tailwind tree-shakes against `content`. Several of them are composed
     (`@apply bt-btn bt-btn-accent`) or referenced from props, so a plain
     content scan can legitimately miss them and silently drop the console's
     entire visual foundation from the bundle. Safelisting the namespace makes
     the system unconditional while leaving it in the components layer, so
     utilities still win the cascade exactly as they do everywhere else. */
  safelist: [
    { pattern: /^bt-(card|panel|page|section|eyebrow|icon|divider|app)/ },
    { pattern: /^bt-(btn|btn-[a-z]+)/ },
    { pattern: /^bt-(input|select|textarea|label)/ },
    { pattern: /^bt-(badge|badge-[a-z]+)/ },
    { pattern: /^bt-(table|table-[a-z]+|kpi|kpi-[a-z-]+)/ },
    { pattern: /^bt-(empty|error|skeleton|option|popover|modal)/ },
  ],

  theme: {
    extend: {
      colors: {
        /* ── Brand tokens ──────────────────────────────────────────────────
           Direct access to the design-token palette, e.g. `bg-bt-navy`,
           `text-bt-orange`, `border-bt-border`. Prefer these in new code. */
        bt: {
          navy: '#15345B',          // --bt-navy        primary brand
          'navy-dark': '#102B4C',   // --bt-navy-dark   headers, active text
          orange: '#F5A000',        // --bt-orange      the single accent
          'orange-dark': '#D98900', // --bt-orange-dark hover
          'orange-light': '#FFF4DD',// --bt-orange-light tinted fills
          bg: '#F6F8FB',           // --bt-bg          app background
          surface: '#FFFFFF',       // --bt-surface     cards
          'surface-soft': '#F9FAFC',// --bt-surface-soft
          ink: '#172033',          // --bt-text-primary
          'ink-2': '#66758C',       // --bt-text-secondary
          'ink-3': '#94A3B8',       // --bt-text-muted
          border: '#E3E8EF',        // --bt-border
          'border-strong': '#D5DDE8',// --bt-border-strong
          success: '#16A36A',
          'success-bg': '#ECFDF5',
          info: '#1683C7',
          'info-bg': '#EFF8FF',
          warning: '#F59E0B',
          'warning-bg': '#FFF7E6',
          danger: '#E5484D',
          'danger-bg': '#FFF1F2',
        },

        /* ── Neutral scale ─────────────────────────────────────────────────
           Retargeted to the Enquiry console's text + border ramp so that the
           ubiquitous `gray-*` utilities resolve to the exact system tokens. */
        gray: {
          50: '#F6F8FB',   // --bt-bg
          100: '#F9FAFC',  // --bt-surface-soft
          200: '#E3E8EF',  // --bt-border
          300: '#D5DDE8',  // --bt-border-strong
          400: '#B4BFD0',
          500: '#94A3B8',  // --bt-text-muted
          600: '#66758C',  // --bt-text-secondary
          700: '#4A5A72',
          800: '#2B3A52',
          900: '#172033',  // --bt-text-primary
        },

        /* ── Brand orange ───────────────────────────────────────────────────
           `amber-*` was already the app's accent; it now points at the exact
           brand orange. `orange-*` is merged in so legacy `orange-*` classes
           stop reading as a second, different accent. */
        amber: {
          50: '#FFF9ED',
          100: '#FFF4DD', // --bt-orange-light
          200: '#FFE8B8',
          300: '#FFD37A',
          400: '#FFBB3D',
          500: '#F5A000', // --bt-orange
          600: '#D98900', // --bt-orange-dark
          700: '#B36F00',
          800: '#8C5600',
          900: '#6B4200',
        },

        /* ── Navy scale ─────────────────────────────────────────────────────
           Every "cool" blue in the app is pulled toward the brand navy so that
           headings, chips and dark surfaces stop reading as generic Bootstrap
           blues and start reading as one enterprise console. */
        blue: {
          50: '#F2F6FB',
          100: '#E2EAF4',
          200: '#C4D3E6',
          300: '#9DB3D0',
          400: '#6E8CB4',
          500: '#456897',
          600: '#2E4F7C',
          700: '#1E4166',
          800: '#15345B', // --bt-navy
          900: '#102B4C', // --bt-navy-dark
          950: '#0B1E36',
        },
        indigo: {
          50: '#F2F6FB',
          100: '#E2EAF4',
          200: '#C4D3E6',
          300: '#9DB3D0',
          400: '#6E8CB4',
          500: '#456897',
          600: '#2E4F7C',
          700: '#1E4166',
          800: '#15345B',
          900: '#102B4C',
        },
        /* Purple was used for "in transit" chips. Collapsing it into the navy
           family removes the last non-semantic colour from the console; genuine
           status meaning now comes from StatusBadge's semantic palette. */
        purple: {
          50: '#F2F6FB',
          100: '#E2EAF4',
          200: '#C4D3E6',
          300: '#9DB3D0',
          400: '#6E8CB4',
          500: '#456897',
          600: '#2E4F7C',
          700: '#1E4166',
          800: '#15345B',
          900: '#102B4C',
        },

        /* Violet was the last "cool but off-brand" family in the console.
           It is folded into the navy scale for the same reason purple was. */
        violet: {
          50: '#F2F6FB',
          100: '#E2EAF4',
          200: '#C4D3E6',
          300: '#9DB3D0',
          400: '#6E8CB4',
          500: '#456897',
          600: '#2E4F7C',
          700: '#1E4166',
          800: '#15345B',
          900: '#102B4C',
        },

        /* ── Semantic: success ───────────────────────────────────────────── */
        emerald: {
          50: '#ECFDF5',   // --bt-success-bg
          100: '#D6F5E6',
          200: '#AEE9CD',
          300: '#6FCFA4',
          400: '#34BC85',
          500: '#16A36A',  // --bt-success
          600: '#12875A',
          700: '#0F6E4A',
          800: '#0C5639',
          900: '#0A422D',
        },
        /* `green-*` is kept in lockstep with emerald so the two never diverge
           into two different "green"s on the same screen. */
        green: {
          50: '#ECFDF5',
          100: '#D6F5E6',
          200: '#AEE9CD',
          300: '#6FCFA4',
          400: '#34BC85',
          500: '#16A36A',
          600: '#12875A',
          700: '#0F6E4A',
          800: '#0C5639',
          900: '#0A422D',
        },

        /* ── Semantic: info ──────────────────────────────────────────────── */
        sky: {
          50: '#EFF8FF',  // --bt-info-bg
          100: '#DCEEFB',
          200: '#B6DDF5',
          300: '#7FC4ED',
          400: '#3FA6E1',
          500: '#1E92D6',
          600: '#1683C7', // --bt-info
          700: '#12689F',
          800: '#0E517D',
          900: '#0B3F61',
        },

        /* ── Semantic: warning ───────────────────────────────────────────── */
        yellow: {
          50: '#FFF7E6',  // --bt-warning-bg
          100: '#FFEDC2',
          200: '#FFD97A',
          300: '#FFC43D',
          400: '#FDB022',
          500: '#F59E0B', // --bt-warning
          600: '#D98900',
          700: '#B36F00',
          800: '#8C5600',
          900: '#6B4200',
        },

        /* ── Semantic: danger ────────────────────────────────────────────── */
        red: {
          50: '#FFF1F2',  // --bt-danger-bg
          100: '#FFE1E3',
          200: '#FBC5C7',
          300: '#F3A3A6',
          400: '#EC6B6F',
          500: '#E5484D', // --bt-danger
          600: '#C93A3F',
          700: '#A82E32',
          800: '#872427',
          900: '#6B1C1E',
        },
        rose: {
          50: '#FFF1F2',
          100: '#FFE1E3',
          200: '#FBC5C7',
          300: '#F3A3A6',
          400: '#EC6B6F',
          500: '#E5484D',
          600: '#C93A3F',
          700: '#A82E32',
          800: '#872427',
          900: '#6B1C1E',
        },

        /* ── Legacy aliases kept for existing call sites ─────────────────── */
        primary: {
          50: '#FFF9ED',
          100: '#FFF4DD',
          200: '#FFE8B8',
          300: '#FFD37A',
          400: '#FFBB3D',
          500: '#F5A000',
          600: '#D98900',
          700: '#B36F00',
          800: '#8C5600',
          900: '#6B4200',
        },
        secondary: {
          50: '#ECFDF5',
          100: '#D6F5E6',
          200: '#AEE9CD',
          300: '#6FCFA4',
          400: '#34BC85',
          500: '#16A36A',
          600: '#12875A',
          700: '#0F6E4A',
          800: '#0C5639',
          900: '#0A422D',
        },
        btb: {
          dark: '#102B4C',
          navy: '#15345B',
          primary: '#F5A000',
          secondary: '#1683C7',
          light: '#FFF4DD',
        },
      },

      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },

      /* One spacing scale for the whole console — 4 8 12 16 20 24 32 40 48 */
      spacing: {
        18: '4.5rem',
        22: '5.5rem',
        26: '6.5rem',
      },

      /* Radii: 10px inputs · 12px buttons · 16px cards · 20px modals */
      borderRadius: {
        'bt-input': '10px',
        'bt-btn': '12px',
        'bt-card': '16px',
        'bt-modal': '20px',
      },

      boxShadow: {
        /* Hairline shadows only — the console reads as premium because nothing
           is heavy, not because nothing is elevated. */
        card: '0 2px 10px rgba(16, 43, 76, 0.04)',
        'card-hover': '0 6px 18px rgba(16, 43, 76, 0.07)',
        popover: '0 12px 32px rgba(16, 43, 76, 0.12)',
        modal: '0 24px 64px rgba(16, 43, 76, 0.18)',
        'focus-orange': '0 0 0 3px rgba(245, 160, 0, 0.18)',
      },

      fontSize: {
        /* Explicit type scale so page titles never drift between modules. */
        'bt-page': ['2rem', { lineHeight: '1.15', letterSpacing: '-0.02em', fontWeight: '700' }],
        'bt-section': ['1.25rem', { lineHeight: '1.3', fontWeight: '700' }],
        'bt-card': ['1.0625rem', { lineHeight: '1.4', fontWeight: '700' }],
        'bt-kpi': ['2rem', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '700' }],
        'bt-label': ['0.75rem', { lineHeight: '1.2', letterSpacing: '0.06em', fontWeight: '600' }],
      },

      transitionDuration: {
        180: '180ms',
      },
    },
  },
  plugins: [],
};
