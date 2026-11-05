/**
 * useSearchNarrative.js
 * ---------------------------------------------------------------------------
 * Drives the "Finding your truck" copy on the confirmation page.
 *
 * The narrative advances on a timer ONLY while the enquiry is genuinely
 * searching for a vehicle (see utils/enquirySearchStage.js). The moment the
 * backend reports an assignment, the timer is torn down and the animation
 * stops — the copy then comes straight from the real status.
 *
 * It is deliberately monotonic: `resolveSearchStage` floors the narrative beat
 * at whatever the server has already reached, so the message can never go
 * backwards when a Socket.IO update lands.
 *
 * @param {string} status      the real `enquiry.status` from the API
 * @param {object} [options]
 * @param {number} [options.intervalMs=7000]  dwell time per narrative beat
 * @param {boolean} [options.respectReducedMotion=true]
 * @returns {{searching:boolean, stage:object, tone:string, headline:string, detail:string}}
 */

import { useEffect, useMemo, useState } from 'react';
import { resolveSearchStage, isSearching, SEARCH_STAGES } from '../utils/enquirySearchStage';

/** True when the visitor asked the OS to reduce motion. */
function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function useSearchNarrative(status, { intervalMs = 7000, respectReducedMotion = true } = {}) {
  const searching = isSearching(status);

  // Reduced-motion visitors get the first honest beat only — the copy never
  // changes underneath them, which is the whole point of the preference.
  const [beat, setBeat] = useState(0);
  const [reduced, setReduced] = useState(() =>
    respectReducedMotion ? prefersReducedMotion() : false
  );

  useEffect(() => {
    if (!respectReducedMotion || typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e) => setReduced(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [respectReducedMotion]);

  // Reset the narrative whenever the enquiry stops searching, so a later
  // status change never inherits a stale "still looking" beat.
  useEffect(() => {
    if (!searching) setBeat(0);
  }, [searching]);

  useEffect(() => {
    if (!searching || reduced) return undefined;
    const id = setInterval(() => {
      setBeat((b) => (b >= SEARCH_STAGES.length - 1 ? b : b + 1));
    }, intervalMs);
    return () => clearInterval(id);
  }, [searching, reduced, intervalMs]);

  const stage = useMemo(
    () => resolveSearchStage(status, reduced ? 0 : beat),
    [status, beat, reduced]
  );

  return { searching: stage.searching, stage, tone: stage.tone, headline: stage.headline, detail: stage.detail };
}

export default useSearchNarrative;
