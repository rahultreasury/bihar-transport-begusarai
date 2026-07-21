import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { getAllStatuses } from './StatusBadge';

/**
 * useBookingFilters
 * Manages filter state, debounced search, and filter reset.
 */
export default function useBookingFilters() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState('');
  const [driverId, setDriverId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [goodsType, setGoodsType] = useState('');
  const [pickupCity, setPickupCity] = useState('');
  const [dropCity, setDropCity] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');

  // Debounce search by 300ms
  const debounceRef = useRef(null);
  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  const resetFilters = useCallback(() => {
    setSearch('');
    setDebouncedSearch('');
    setStatus('');
    setDriverId('');
    setVehicleId('');
    setGoodsType('');
    setPickupCity('');
    setDropCity('');
    setDateFrom('');
    setDateTo('');
    setPriceMin('');
    setPriceMax('');
  }, []);

  const hasActiveFilters = useMemo(() => {
    return !!(
      debouncedSearch ||
      status ||
      driverId ||
      vehicleId ||
      goodsType ||
      pickupCity ||
      dropCity ||
      dateFrom ||
      dateTo ||
      priceMin ||
      priceMax
    );
  }, [debouncedSearch, status, driverId, vehicleId, goodsType, pickupCity, dropCity, dateFrom, dateTo, priceMin, priceMax]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (debouncedSearch) count++;
    if (status) count++;
    if (driverId) count++;
    if (vehicleId) count++;
    if (goodsType) count++;
    if (pickupCity) count++;
    if (dropCity) count++;
    if (dateFrom || dateTo) count++;
    if (priceMin || priceMax) count++;
    return count;
  }, [debouncedSearch, status, driverId, vehicleId, goodsType, pickupCity, dropCity, dateFrom, dateTo, priceMin, priceMax]);

  // Build query params for API
  const queryParams = useMemo(() => {
    const params = {};
    if (debouncedSearch) params.search = debouncedSearch;
    if (status) params.status = status;
    if (driverId) params.driver_id = driverId;
    if (vehicleId) params.vehicle_id = vehicleId;
    if (goodsType) params.goods_type = goodsType;
    if (pickupCity) params.pickup_city = pickupCity;
    if (dropCity) params.drop_city = dropCity;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    if (priceMin) params.price_min = priceMin;
    if (priceMax) params.price_max = priceMax;
    return params;
  }, [debouncedSearch, status, driverId, vehicleId, goodsType, pickupCity, dropCity, dateFrom, dateTo, priceMin, priceMax]);

  const statusOptions = useMemo(() => getAllStatuses(), []);

  return {
    // State
    search, setSearch,
    debouncedSearch,
    status, setStatus,
    driverId, setDriverId,
    vehicleId, setVehicleId,
    goodsType, setGoodsType,
    pickupCity, setPickupCity,
    dropCity, setDropCity,
    dateFrom, setDateFrom,
    dateTo, setDateTo,
    priceMin, setPriceMin,
    priceMax, setPriceMax,

    // Computed
    resetFilters,
    hasActiveFilters,
    activeFilterCount,
    queryParams,
    statusOptions
  };
}

