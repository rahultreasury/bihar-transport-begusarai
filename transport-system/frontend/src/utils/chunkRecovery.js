/**
 * chunkRecovery.js
 *
 * Controlled recovery for failed Vite dynamic imports (chunk load failures).
 *
 * Production scenario:
 *   Old browser → old index/chunk reference → new deployment → old chunk removed
 *   → React.lazy import fails → white screen
 *
 * This module provides a single controlled refresh. It does NOT create
 * infinite reload loops.
 */

const CHUNK_ERROR_CODE = 'CHUNK_LOAD_ERROR';
const CHUNK_ERROR_MESSAGE = 'Loading chunk';

let hasRecovered = false;

/**
 * Wrap a dynamic import with controlled chunk-failure recovery.
 *
 * @param {Function} importFn - The dynamic import function (e.g. () => import('./AdminDashboard'))
 * @returns {Promise<React.ComponentType>}
 */
export function safeLazyImport(importFn) {
  return function lazyLoader() {
    return importFn()
      .then((module) => ({ default: module.default || module }))
      .catch((error) => {
        // Detect chunk load failure.
        const isChunkError =
          error?.message?.includes(CHUNK_ERROR_MESSAGE) ||
          error?.code === CHUNK_ERROR_CODE ||
          error?.name === 'ChunkLoadError' ||
          (error?.message?.includes('Failed to fetch') && error?.message?.includes('chunk'));

        if (isChunkError && !hasRecovered) {
          hasRecovered = true;
          // One controlled refresh. After this, the new deployment's chunks
          // will be loaded normally.
          if (typeof window !== 'undefined') {
            window.location.reload();
          }
        }

        // Re-throw so the Error Boundary can catch it and show the fallback UI.
        throw error;
      });
  };
}

/**
 * Reset the recovery flag. Useful in tests or when you want to allow
 * another recovery attempt after a successful load.
 */
export function resetChunkRecovery() {
  hasRecovered = false;
}

export default { safeLazyImport, resetChunkRecovery };
