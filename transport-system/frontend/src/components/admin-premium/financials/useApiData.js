import { useEffect, useRef, useState } from 'react';

/**
 * useApiData — one loading/error/data state machine for every finance tab.
 *
 * `loader` is kept in a ref so an inline arrow function does not re-trigger the
 * effect on every render; the caller controls re-fetching through `deps`.
 */
export function useApiData(loader, deps = []) {
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const [state, setState] = useState({ data: null, loading: true, error: null });

  useEffect(() => {
    let alive = true;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    Promise.resolve()
      .then(() => loaderRef.current())
      .then((data) => {
        if (alive) setState({ data, loading: false, error: null });
      })
      .catch((error) => {
        if (alive) {
          setState({
            data: null,
            loading: false,
            error: error?.response?.data?.message || error?.message || 'Could not load this section.',
          });
        }
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
