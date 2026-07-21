export default function PageLoader({ label = 'Loading...' }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface">
      <div className="flex flex-col items-center gap-3">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-amber-500 border-t-transparent" />
        <div className="text-sm text-muted font-medium">{label}</div>
      </div>
    </div>
  );
}

