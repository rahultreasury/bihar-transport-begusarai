import { useState, useCallback, useMemo } from 'react';

/**
 * useBookingSelection
 * Manages row selection, bulk selection, and keyboard navigation for the booking table.
 */
export default function useBookingSelection(bookings = []) {
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState(-1);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const bookingIds = useMemo(() => bookings.map(b => b.booking_id), [bookings]);

  const toggleSelection = useCallback((id, index) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setLastSelectedIndex(index);
  }, []);

  const selectAll = useCallback(() => {
    if (selectedIds.size === bookings.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(bookingIds));
    }
  }, [bookings.length, bookingIds, selectedIds]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setLastSelectedIndex(-1);
  }, []);

  const isAllSelected = useMemo(() => {
    return bookings.length > 0 && selectedIds.size === bookings.length;
  }, [bookings.length, selectedIds]);

  const isIndeterminate = useMemo(() => {
    return selectedIds.size > 0 && selectedIds.size < bookings.length;
  }, [bookings.length, selectedIds]);

  const selectedCount = useMemo(() => selectedIds.size, [selectedIds]);

  const selectedBookings = useMemo(() => {
    return bookings.filter(b => selectedIds.has(b.booking_id));
  }, [bookings, selectedIds]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e) => {
    if (bookings.length === 0) return;

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        setFocusedIndex(prev => Math.min(prev + 1, bookings.length - 1));
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        setFocusedIndex(prev => Math.max(prev - 1, 0));
        break;
      }
      case ' ': {
        e.preventDefault();
        if (focusedIndex >= 0) {
          const booking = bookings[focusedIndex];
          toggleSelection(booking.booking_id, focusedIndex);
        }
        break;
      }
      case 'Escape': {
        clearSelection();
        setFocusedIndex(-1);
        break;
      }
    }
  }, [bookings, focusedIndex, toggleSelection, clearSelection]);

  return {
    selectedIds,
    selectedCount,
    selectedBookings,
    isAllSelected,
    isIndeterminate,
    focusedIndex,
    lastSelectedIndex,

    toggleSelection,
    selectAll,
    clearSelection,
    setFocusedIndex,
    handleKeyDown
  };
}

