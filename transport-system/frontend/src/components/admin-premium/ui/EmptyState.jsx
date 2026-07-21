export default function EmptyState({ title = 'No data', subtitle = 'Try changing your filters or check back later.' }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/70 p-6 text-center">
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-xs text-muted mt-2">{subtitle}</div>
    </div>
  );
}

