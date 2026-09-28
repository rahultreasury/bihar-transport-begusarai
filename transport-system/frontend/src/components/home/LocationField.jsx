/**
 * LocationField.jsx
 * ---------------------------------------------------------------------------
 * A booking-bar location field (Home page Pickup / Drop).
 *
 * DESIGN CONTRACT
 * ---------------
 * The `<input>` is rendered UNCONDITIONALLY. It is never a child of a script
 * loader, a lazy boundary or any `isLoaded && …` conditional, so the field is
 * in the DOM on first paint, after a refresh, and on every viewport. This is
 * the fix for the "Pickup and Drop input boxes are invisible / collapsed"
 * report — see `usePlacesAutocomplete` for the full root-cause write-up.
 *
 * Autocomplete is layered on top of that permanent input:
 *   • Google Places is attached imperatively as soon as the shared Maps loader
 *     reports the API live. It is the primary, preferred path.
 *   • Until (or unless) that happens, the field serves suggestions from
 *     `data/homeLocations.js`, so typing "Patna" always produces a list.
 *
 * The microphone button and the voice status toast are passed in as slots
 * because their state lives in the shared `useVoiceSearch` hook on the page.
 * They stay inside the same `relative` wrapper as the input, so the mic is
 * anchored to the field's right edge and the input reserves padding for it.
 */

import { useCallback, useId, useMemo, useRef, useState } from 'react';
import usePlacesAutocomplete from '../../hooks/usePlacesAutocomplete';
import { searchHomeLocations } from '../../data/homeLocations';
import LocationSuggestionMenu from './LocationSuggestionMenu';

/** Kept identical to the previous <Autocomplete options> so results don't change. */
const PLACES_OPTIONS = Object.freeze({
  componentRestrictions: { country: 'in' },
  types: ['geocode'],
});

const MAX_SUGGESTIONS = 6;

export default function LocationField({
  id,
  label,
  placeholder,
  value,
  onChange,
  onSelectPlace,
  inputRef,
  micSlot = null,
  statusSlot = null,
  hasMic = false,
}) {
  const reactId = useId();
  const listId = `${id || `location-${reactId}`}-listbox`;

  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Internal ref so the field is self-contained; mirrored into the page's
  // `inputRef` for the shared voice-search hook.
  const localRef = useRef(null);

  const setInputNode = useCallback(
    (node) => {
      localRef.current = node;
      if (inputRef) inputRef.current = node;
    },
    [inputRef]
  );

  const handlePlaceSelected = useCallback(
    (place) => {
      if (!place) return;
      const lat = place.geometry?.location?.lat?.() ?? null;
      const lng = place.geometry?.location?.lng?.() ?? null;
      const label = place.formatted_address || place.name || '';
      // A typed-but-not-chosen prediction has no geometry; ignore it rather
      // than writing an empty location into the booking state.
      if (!label || lat == null || lng == null) return;

      onSelectPlace?.({
        label,
        placeId: place.place_id || '',
        lat,
        lng,
        source: 'google',
      });
      setIsOpen(false);
      setActiveIndex(-1);
    },
    [onSelectPlace]
  );

  const { isReady } = usePlacesAutocomplete({
    inputRef: localRef,
    options: PLACES_OPTIONS,
    onPlaceSelected: handlePlaceSelected,
  });

  const query = String(value ?? '');

  const suggestions = useMemo(
    // Google's own dropdown owns the UI the moment it is attached.
    () => (isReady ? [] : searchHomeLocations(query, MAX_SUGGESTIONS)),
    [isReady, query]
  );

  const showMenu = isOpen && suggestions.length > 0;

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setActiveIndex(-1);
  }, []);

  const handleSelectSuggestion = useCallback(
    (item) => {
      onSelectPlace?.({
        label: item.label,
        placeId: item.id,
        lat: item.lat,
        lng: item.lng,
        source: 'local',
      });
      closeMenu();
      localRef.current?.focus();
    },
    [closeMenu, onSelectPlace]
  );

  const handleKeyDown = useCallback(
    (event) => {
      if (!showMenu) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') setIsOpen(true);
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((prev) => (prev + 1) % suggestions.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
      } else if (event.key === 'Enter' && activeIndex >= 0) {
        // Only intercept Enter when a suggestion is highlighted, otherwise the
        // key must keep working for the Google dropdown.
        event.preventDefault();
        const item = suggestions[activeIndex];
        if (item) handleSelectSuggestion(item);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
      }
    },
    [activeIndex, closeMenu, handleSelectSuggestion, showMenu, suggestions]
  );

  return (
    <div className="relative z-20">
      <input
        id={id}
        ref={setInputNode}
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck="false"
        aria-expanded={showMenu}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-label={label}
        placeholder={placeholder}
        // A native input scrolls rather than ellipsises, so surface the full
        // address on hover — otherwise "Patna Junction, Patna, Bihar, India"
        // is unreadable once it does not fit the field.
        title={query || undefined}
        value={query}
        onChange={(event) => onChange?.(event.target.value)}
        onFocus={() => setIsOpen(true)}
        // Deferred so a click on a suggestion lands before the menu unmounts.
        onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
        onKeyDown={handleKeyDown}
        // `h-[52px]` is a fixed height rather than vertical padding, so this
        // input stays pixel-identical to the Vehicle select and the Continue
        // button at every breakpoint — the whole bar reads as one compact
        // control strip. 52 + a 16px label + a 6px gap + 2×16px card padding
        // + 2px of border is the ~108px total the hero booking card targets.
        // `min-w-0` lets a long address shrink inside its grid track instead
        // of stretching the row.
        //
        // `rounded-[10px]` matches the select; the Continue button keeps
        // `rounded-xl` (12px) so the corner language steps down from container
        // (20px) → control (10px) → action (12px) without any piece looking
        // like a different component.
        //
        // `text-[13px]` is deliberate, not a downgrade. The hero bar gives this
        // field ~31% of a `clamp(660px, 45vw, 700px)` card while the 36px mic
        // button reserves 42px on the right, so at 14px the full
        // "Enter pickup location" placeholder clipped mid-word. At 13px the
        // whole string fits at every desktop width, and a 13px body size is
        // the normal weight for a 52px-tall compact control.
        className={[
          'block h-[52px] w-full min-w-0 rounded-[10px] border border-gray-300 bg-white pl-2 text-[13px] text-gray-900',
          'placeholder:text-gray-400 placeholder:font-normal',
          'transition-all outline-none',
          'focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30',
          // The 36px mic button pinned at `right-1.5` occupies 42px; `pr-[42px]`
          // meets it exactly so the text never touches the microphone while
          // costing 2px less than the old `pr-11`. This reservation is
          // untouched — the voice affordance is mandatory, so the text area is
          // what gives way, not the button.
          hasMic ? 'pr-[42px]' : 'pr-2',
        ].join(' ')}
      />

      {micSlot}
      {statusSlot}

      <LocationSuggestionMenu
        anchorRef={localRef}
        items={showMenu ? suggestions : []}
        activeIndex={activeIndex}
        onActiveIndexChange={setActiveIndex}
        onSelect={handleSelectSuggestion}
        listId={listId}
      />
    </div>
  );
}
