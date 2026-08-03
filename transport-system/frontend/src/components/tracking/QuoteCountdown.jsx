import React, { useState, useEffect, useCallback } from 'react';

/**
 * QuoteCountdown — Live countdown timer to quote expiry.
 * Renders HH:MM:SS and calls `onExpire` exactly once when it reaches zero.
 *
 * @param {{ expiresAt?: string|number, onExpire?: () => void, size?: 'sm'|'lg' }} props
 */
const QuoteCountdown = React.memo(function QuoteCountdown({
  expiresAt,
  onExpire,
  size = 'lg',
}) {
  const [remainingMs, setRemainingMs] = useState(() => {
    if (!expiresAt) return 0;
    const target = new Date(expiresAt).getTime();
    return Math.max(0, target - Date.now());
  });

  useEffect(() => {
    if (!expiresAt) return undefined;
    const target = new Date(expiresAt).getTime();
    const tick = () => setRemainingMs(Math.max(0, target - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const expired = remainingMs <= 0;

  // Fire onExpire once when the countdown hits zero.
  const fireRef = useRef(false);
  useEffect(() => {
    if (expired && onExpire && !fireRef.current) {
      fireRef.current = true;
      onExpire();
    }
  }, [expired, onExpire]);

  const seconds = Math.floor(remainingMs / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  const pad = (n) => String(n).padStart(2, '0');
  const timeString = `${pad(h)}:${pad(m)}:${pad(s)}`;
  const isDanger = !expired && remainingMs < 5 * 60 * 1000;

  const sizeClasses =
    size === 'lg'
      ? 'text-3xl md:text-4xl tracking-tight'
      : 'text-sm font-semibold';

  return (
    <div className="flex items-center gap-2" role="timer" aria-live="polite" aria-label="Quote expires in">
      <span
        className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-mono tabular-nums font-bold ${
          sizeClasses
        } ${
          expired
            ? 'bg-gray-100 text-gray-400'
            : isDanger
            ? 'bg-red-50 text-red-600'
            : 'bg-amber-50 text-amber-700'
        }`}
      >
        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        {expired ? 'Expired' : timeString}
      </span>
    </div>
  );
});

export default QuoteCountdown;
