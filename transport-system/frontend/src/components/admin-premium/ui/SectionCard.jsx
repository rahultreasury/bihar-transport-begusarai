/**
 * SectionCard.jsx
 * ---------------------------------------------------------------------------
 * The console's one card primitive. Used by 24 admin + 6 partner pages, so
 * every one of them inherits the Enquiry page's card language from here.
 *
 * THE LOOK
 *   white surface · 1px cool-grey border · 16px radius · hairline shadow
 *   header: [orange icon chip]  SECTION TITLE
 *                             Subtitle
 *
 * PROPS
 *   title     string   section heading (rendered uppercase + tracked)
 *   subtitle  string   optional one-line explanation under the heading
 *   icon      Lucide   optional icon in the orange chip
 *   action    node     right-hand controls (buttons, links, filters)
 *   right     node     legacy alias for `action` — still honoured
 *   children  node     card body
 *   bodyClass string   extra classes for the padded body
 *   padded    bool     set false for flush tables that manage their own padding
 *   className string   extra classes on the card itself
 */

export default function SectionCard({
  title,
  subtitle,
  icon: Icon,
  action,
  right,
  children,
  bodyClass = '',
  padded = true,
  className = '',
}) {
  // `right` is the historical prop name; `action` is the clearer one. Accept
  // both so no existing call site has to change.
  const trailing = action ?? right;
  const hasHeader = Boolean(title || subtitle || trailing);

  return (
    <section className={`bt-card bt-card-hover overflow-hidden ${className}`}>
      {hasHeader && (
        <header className="bt-card-header">
          <div className="flex min-w-0 items-center gap-3">
            {Icon ? (
              <span className="bt-icon-chip" aria-hidden="true">
                <Icon className="h-[18px] w-[18px]" strokeWidth={2.1} />
              </span>
            ) : null}
            <div className="min-w-0">
              {title ? (
                <h2 className="bt-section-title truncate uppercase tracking-[0.02em]">{title}</h2>
              ) : null}
              {subtitle ? <p className="bt-section-subtitle">{subtitle}</p> : null}
            </div>
          </div>
          {trailing ? <div className="shrink-0">{trailing}</div> : null}
        </header>
      )}

      <div className={padded ? `p-5 ${bodyClass}` : bodyClass}>{children}</div>
    </section>
  );
}
