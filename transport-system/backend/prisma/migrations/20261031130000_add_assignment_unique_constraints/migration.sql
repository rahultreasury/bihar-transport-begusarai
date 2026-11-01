-- MODULE 2 P0: Enforce unique active assignments at DB level
-- Prevents duplicate active vehicle/driver assignments

-- Create partial unique indexes for active trips
-- Active statuses per TripStateMachine: PENDING, ASSIGNED, TO_LOADING_POINT, AT_LOADING_POINT, LOADED, DISPATCHED, IN_TRANSIT, DELIVERED
CREATE UNIQUE INDEX IF NOT EXISTS idx_trips_unique_active_vehicle 
ON trips (vehicle_id) 
WHERE vehicle_id IS NOT NULL 
  AND status IN ('PENDING', 'ASSIGNED', 'TO_LOADING_POINT', 'AT_LOADING_POINT', 'LOADED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED');

CREATE UNIQUE INDEX IF NOT EXISTS idx_trips_unique_active_driver 
ON trips (driver_id) 
WHERE driver_id IS NOT NULL 
  AND status IN ('PENDING', 'ASSIGNED', 'TO_LOADING_POINT', 'AT_LOADING_POINT', 'LOADED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED');

-- Add comments
COMMENT ON INDEX idx_trips_unique_active_vehicle IS 'Module 2 P0: Ensure one vehicle cannot have multiple active trip assignments';
COMMENT ON INDEX idx_trips_unique_active_driver IS 'Module 2 P0: Ensure one driver cannot have multiple active trip assignments';
