import React, { useCallback, useMemo, useRef } from 'react';
import { Autocomplete } from '@react-google-maps/api';

const CityAutocomplete = ({
  value,
  onChange,
  placeholder = 'Enter location',
  onPlaceSelected,
  restrictions = { country: 'in' },
}) => {
  const autocompleteRef = useRef(null);

  const options = useMemo(
    () => ({
      componentRestrictions: restrictions,
      types: ['geocode'],
    }),
    [restrictions]
  );

  const onLoad = useCallback((autocomplete) => {
    autocompleteRef.current = autocomplete;
  }, []);

  const onPlaceChanged = useCallback(() => {
    const ac = autocompleteRef.current;
    if (!ac) return;

    const place = ac.getPlace && ac.getPlace();
    if (!place || !place.geometry || !place.geometry.location) return;

    const formatted_address = place.formatted_address || place.name || value;
    const place_id = place.place_id;

    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();

    onChange(formatted_address || '');

    if (onPlaceSelected) {
      onPlaceSelected({
        place_id,
        formatted_address,
        lat,
        lng,
      });
    }
  }, [onChange, onPlaceSelected, value]);

  return (
    <Autocomplete options={options} onLoad={onLoad} onPlaceChanged={onPlaceChanged}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-2 py-2 md:py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all bg-white text-gray-700 text-sm"
      />
    </Autocomplete>
  );
};

export default CityAutocomplete;

