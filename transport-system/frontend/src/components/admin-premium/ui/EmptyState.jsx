/**
 * EmptyState.jsx
 * ---------------------------------------------------------------------------
 * What a section shows when an API honestly returns nothing. A dashed frame on
 * the soft surface with a muted glyph — quiet, never a blank white void, never
 * an alarming red block.
 *
 * PROPS
 *   title     string  headline
 *   subtitle  string  one line of guidance
 *   icon      Lucide  optional glyph (defaults to an inbox)
 *   action    node    optional call to action, e.g. a "Clear filters" button
 */

import { Inbox } from 'lucide-react';

export default function EmptyState({
  title = 'No data',
  subtitle = 'Try changing your filters or check back later.',
  icon: Icon = Inbox,
  action,
}) {
  return (
    <div className="bt-empty">
      <span
        className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-bt-orange-light text-bt-orange-dark"
        aria-hidden="true"
      >
        <Icon className="h-5 w-5" strokeWidth={1.9} />
      </span>
      <p className="text-[15px] font-semibold text-bt-navy">{title}</p>
      {subtitle ? (
        <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-bt-ink-2">{subtitle}</p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
