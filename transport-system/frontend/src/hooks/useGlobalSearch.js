import { useState, useEffect, useRef } from 'react';
import { globalSearchAPI } from '../services/api';

export default function useGlobalSearch(query, enabled = true) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [totalResults, setTotalResults] = useState(0);
  const abortRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!enabled) return;
    const q = String(query || '').trim();
    if (timerRef.current) clearTimeout(timerRef.current);
    if (abortRef.current) abortRef.current.abort();

    if (!q) {
      setResults([]);
      setTotalResults(0);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    timerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await globalSearchAPI.search(q, { signal: controller.signal });
        const data = res?.data || {};
        setResults(Array.isArray(data.categories) ? data.categories : []);
        setTotalResults(Number.isFinite(data.totalResults) ? data.totalResults : 0);
        setError(null);
      } catch (err) {
        if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED' || err?.message === 'canceled') {
          return;
        }
        setError(err?.response?.data?.message || 'Search failed');
        setResults([]);
        setTotalResults(0);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, enabled]);

  return { results, loading, error, totalResults };
}
