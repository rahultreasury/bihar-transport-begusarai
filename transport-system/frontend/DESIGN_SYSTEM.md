# Bihar Transport — Admin Design System

The admin console is one product, not thirty pages. This document is the
contract that keeps it that way.

**The Enquiry workspace is the master reference.** When in doubt about how
something should look, ask: *"does this look like it belongs in the Enquiry
console?"* If not, it changes.

---

## 1. Where things live

| Concern | Single source of truth |
|---|---|
| Colour tokens (`--bt-*`) | [`src/index.css`](src/index.css) `:root` |
| Palette + type + radii + shadows | [`tailwind.config.js`](tailwind.config.js) |
| Component class layer (`bt-*`) | [`src/index.css`](src/index.css) `@layer components` |
| React primitives | [`src/components/admin-premium/ui/`](src/components/admin-premium/ui) |
| One import path | `admin-premium/ui/index.js` |
| Layout shell | `admin-premium/layout/AdminShell.jsx` |

**Never hardcode a colour in a page.** If a page needs a colour that is not a
token, the token is missing — add it to the token block, not to the page.

---

## 2. Colour

```
Navy + White + Soft Gray carry the interface.
Orange is a small, deliberate accent.
```

| Token | Value | Use |
|---|---|---|
| `--bt-navy` | `#15345B` | headings, primary buttons, sidebar |
| `--bt-navy-dark` | `#102B4C` | hover states, orange button text |
| `--bt-orange` | `#F5A000` | primary/brand action, active nav, focus |
| `--bt-orange-dark` | `#D98900` | orange hover, accent text on tint |
| `--bt-orange-light` | `#FFF4DD` | icon chips, selected rows |
| `--bt-bg` | `#F6F8FB` | app background |
| `--bt-surface` | `#FFFFFF` | cards, tables, inputs |
| `--bt-surface-soft` | `#F9FAFC` | table headers, modal footers |
| `--bt-text-primary` | `#172033` | body text |
| `--bt-text-secondary` | `#66758C` | descriptions |
| `--bt-text-muted` | `#94A3B8` | labels, placeholders |
| `--bt-border` | `#E3E8EF` | hairlines |
| `--bt-border-strong` | `#D5DDE8` | inputs, emphasised borders |
| `--bt-success` / `-bg` | `#16A36A` / `#ECFDF5` | completed, paid, active |
| `--bt-info` / `-bg` | `#1683C7` / `#EFF8FF` | assigned, partial |
| `--bt-warning` / `-bg` | `#F59E0B` / `#FFF7E6` | pending, awaiting |
| `--bt-danger` / `-bg` | `#E5484D` / `#FFF1F2` | rejected, cancelled, outstanding |

### The colour rule

Orange is for **primary buttons, active navigation, selected controls, focus
rings and key highlights.** Never a whole card. The premium read comes from
navy + white + soft grey with small orange accents.

The Tailwind palette is re-pointed at these tokens, so legacy `amber-500`,
`blue-800`, `gray-200` and friends resolve to the brand automatically. New code
should still prefer the explicit `bt-*` names (`bg-bt-navy`, `text-bt-ink-2`).

---

## 3. Geometry

| Thing | Value | Class |
|---|---|---|
| Input | 10px radius, 42px tall | `.bt-input` |
| Button | 12px radius, 36/42/46px | `.bt-btn` |
| Card | 16px radius, 1px border, hairline shadow | `.bt-card` |
| Modal | 20px radius | `.bt-modal-panel` |
| Badge | pill, 12px label, 6px dot | `.bt-badge` |
| Header | 72px, white, 1px bottom border | `AdminTopHeader` |
| Page gutter | 16 / 24 / 32px | `AdminShell` |

Spacing scale: `4 8 12 16 20 24 32 40 48`. Card gaps: 16–24px.

Shadow is always hairline: `0 2px 10px rgba(16,43,76,0.04)`. Nothing heavy.

---

## 4. Typography

`Inter` throughout.

| Level | Size / weight |
|---|---|
| Page title | 30–34px / 700 · `.bt-page-title` |
| Section title | 17–20px / 700 · `.bt-section-title` |
| Card title | 16–18px / 700 |
| Body | 14–16px / 400–500 |
| Label / eyebrow | 11–13px / 600–700, uppercase, tracked |
| KPI number | 28–36px / 700 · `.bt-kpi-value` |

---

## 5. Page anatomy

Every admin page follows this order:

```
TOP HEADER (72px, white, sticky)
──────────────────────────────
PAGE TITLE          (bt-page-title)
Description         (bt-page-desc)
[ actions ]

KPI / SUMMARY       (KpiCard)

FILTERS / SEARCH    (FilterBar · SearchBar · FilterSelect)

MAIN CONTENT        (SectionCard · PremiumTable)
```

---

## 6. Components

Import them all from one place:

```jsx
import AdminShell, {
  PageHeader, SectionCard, KpiCard, PremiumTable, EmptyState,
  Button, StatusBadge, SearchBar, FilterBar, FilterSelect,
  FormField, AdminModal, ErrorState, IconTile,
  SkeletonKpis, SkeletonTable,
  CHART_COLORS, CHART_SERIES, CHART_TOOLTIP,
} from '../components/admin-premium/ui';
```

- **`PageHeader`** — title, description, actions. The only page heading.
- **`SectionCard`** — the card. Optional `icon`, `subtitle`, `action`.
- **`KpiCard`** — label · big navy number · caption, with one semantic accent edge.
- **`Button`** — `primary | accent | secondary | ghost | danger`.
- **`StatusBadge`** — one badge; tone is resolved from the status string.
- **`PremiumTable`** — the data table. Scrolls horizontally *inside* itself.
- **`SearchBar` / `FilterBar` / `FilterSelect`** — the filter row.
- **`FormField`** — label + control + hint + error.
- **`AdminModal`** — the one dialog treatment.
- **`ErrorState` / `EmptyState` / `SkeletonKpis` / `SkeletonTable`** — honest states.

### Status tones

`Confirmed` `Completed` `Paid` → success · `Vehicle Assigned` `Driver Assigned`
`Partially Paid` → info · `Pending` `Awaiting Quote` → warning · `Quote Sent` →
accent · `Rejected` `Outstanding` → danger · `Cancelled` → neutral.

Pass `status`, not a colour. `resolveStatusTone()` does the rest.

---

## 7. Charts

Recharts takes literal strings, so chart colours live in `CHART_*` constants —
never inline hex. Use `CHART_SERIES` for categorical data; it is a brand ramp,
not a rainbow.

---

## 8. Responsive

- Navigation is an overlay drawer, so it never reserves width.
- Tables scroll inside their own container; the page itself never overflows.
- KPI grids collapse `4 → 2 → 1`; two-column layouts become one.
- The header sheds its label text on small screens rather than shrinking.

---

## 9. Verifying a change

```bash
npm run check:design   # renders every primitive; asserts status tones + class names
npm run build          # production build must be clean
```

`check:design` exists so a token or component change can be verified without a
browser. Keep it passing.

---

## 10. Rules of thumb

1. Read the token, don't invent a colour.
2. Render from the shared components, don't re-style a card locally.
3. Show an honest loading, empty and error state — never a blank white void.
4. Orange marks the one thing you can act on. Nothing else.
5. If a page starts to feel different from the Enquiry console, it is wrong.
