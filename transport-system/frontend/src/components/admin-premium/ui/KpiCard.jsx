export default function KpiCard({
  title,
  value,
  sub,
  accent = 'amber',
  loading,
}) {
  const accentClass =
    accent === 'green'
      ? 'from-green-500/20 to-green-500'
      : accent === 'purple'
        ? 'from-purple-500/20 to-purple-500'
        : accent === 'sky'
          ? 'from-sky-500/20 to-sky-500'
          : 'from-amber-500/20 to-amber-500';

  return (
    <div className="rounded-3xl border border-border/60 bg-card/40 backdrop-blur-xl p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-muted font-medium">{title}</div>
          {loading ? (
            <div className="h-7 w-28 mt-3 rounded-lg bg-skeleton" />
          ) : (
            <div className="text-3xl font-semibold mt-1">
              {value}
            </div>
          )}
          {sub && (
            <div className="text-xs text-muted mt-2">{sub}</div>
          )}
        </div>
        <div className={`h-10 w-10 rounded-2xl bg-gradient-to-br ${accentClass} text-white flex items-center justify-center`}>
          <span className="text-lg">↗</span>
        </div>
      </div>
    </div>
  );
}

