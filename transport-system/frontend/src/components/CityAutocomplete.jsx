import React, { useCallback, useRef } from 'react';
import { Autocomplete } from '@react-google-maps/api';

const CityAutocomplete = ({ label, value, onChange, placeholder = 'Enter city' }) => {
  const autocompleteRef = useRef(null);

  const onLoad = useCallback((autocomplete) => {
    autocompleteRef.current = autocomplete;
  }, []);

  const onPlaceChanged = useCallback(() => {
    if (autocompleteRef.current) {
      const place = autocompleteRef.current.getPlace();
      if (place && place.name) {
        // Extract city name, prioritize 'locality' or 'administrative_area_level_2', fallback to name
        const cityName = place.address_components?.find(comp => 
          comp.types.includes('locality') || 
          comp.types.includes('administrative_area_level_2') || 
          comp.types.includes('sublocality_level_1')
        )?.long_name || place.name;
        
        onChange(cityName);
      }
    }
  }, [onChange]);

  const options = {
    componentRestrictions: { country: 'in' },
    types: ['(cities)'],
  };

  return (
    <div>
      {label && (
        <label className="block text-xs font-semibold text-gray-600 mb-1">
          {label}
        </label>
      )}
      <Autocomplete
        onLoad={onLoad}
        onPlaceChanged={onPlaceChanged}
        options={options}
      >
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)} // Allow manual typing
          placeholder={placeholder}
          className="w-full px-2 py-2 md:py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition-all bg-white text-gray-700 text-sm h-10"
        />
      </Autocomplete>
    </div>
  );
};

export default CityAutocomplete;

