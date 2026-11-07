-- Non-destructive duplicate-guard triggers and constraints
-- This migration adds application-level duplicate prevention at the database level
-- without affecting existing duplicate records (which are handled at the app layer)

-- ============================================================
-- 1. DRIVER TABLE: Prevent duplicate mobile and license_number
--    Only on INSERT or when the field changes on UPDATE
--    Existing duplicates (e.g., mobile 9709907415 on driver_ids 2,4;
--    license BR01-2020-458796 on driver_ids 2,12) are NOT removed.
-- ============================================================

-- Function to check driver mobile uniqueness (ignoring existing duplicates on UPDATE unless mobile changes)
CREATE OR REPLACE FUNCTION check_driver_mobile_unique()
RETURNS TRIGGER AS $$
DECLARE
    existing_count INTEGER;
BEGIN
    -- On INSERT: check if mobile already exists
    IF TG_OP = 'INSERT' THEN
        SELECT COUNT(*) INTO existing_count
        FROM drivers
        WHERE mobile = NEW.mobile;
        
        IF existing_count > 0 THEN
            RAISE EXCEPTION 'Driver with mobile % already exists', NEW.mobile
            USING ERRCODE = 'unique_violation';
        END IF;
    
    -- On UPDATE: only check if mobile field actually changed
    ELSIF TG_OP = 'UPDATE' AND OLD.mobile IS DISTINCT FROM NEW.mobile THEN
        SELECT COUNT(*) INTO existing_count
        FROM drivers
        WHERE mobile = NEW.mobile;
        
        IF existing_count > 0 THEN
            RAISE EXCEPTION 'Driver with mobile % already exists', NEW.mobile
            USING ERRCODE = 'unique_violation';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for driver mobile
DROP TRIGGER IF EXISTS trg_driver_mobile_unique ON drivers;
CREATE TRIGGER trg_driver_mobile_unique
    BEFORE INSERT OR UPDATE OF mobile ON drivers
    FOR EACH ROW
    EXECUTE FUNCTION check_driver_mobile_unique();

-- Function to check driver license_number uniqueness
CREATE OR REPLACE FUNCTION check_driver_license_unique()
RETURNS TRIGGER AS $$
DECLARE
    existing_count INTEGER;
BEGIN
    -- Only validate when license_number is provided (not null/empty)
    IF NEW.license_number IS NULL OR NEW.license_number = '' THEN
        RETURN NEW;
    END IF;
    
    -- On INSERT: check if license already exists
    IF TG_OP = 'INSERT' THEN
        SELECT COUNT(*) INTO existing_count
        FROM drivers
        WHERE license_number = NEW.license_number;
        
        IF existing_count > 0 THEN
            RAISE EXCEPTION 'Driver with license number % already exists', NEW.license_number
            USING ERRCODE = 'unique_violation';
        END IF;
    
    -- On UPDATE: only check if license_number field actually changed
    ELSIF TG_OP = 'UPDATE' AND OLD.license_number IS DISTINCT FROM NEW.license_number THEN
        SELECT COUNT(*) INTO existing_count
        FROM drivers
        WHERE license_number = NEW.license_number;
        
        IF existing_count > 0 THEN
            RAISE EXCEPTION 'Driver with license number % already exists', NEW.license_number
            USING ERRCODE = 'unique_violation';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for driver license_number
DROP TRIGGER IF EXISTS trg_driver_license_unique ON drivers;
CREATE TRIGGER trg_driver_license_unique
    BEFORE INSERT OR UPDATE OF license_number ON drivers
    FOR EACH ROW
    EXECUTE FUNCTION check_driver_license_unique();

-- ============================================================
-- 2. VEHICLE_OWNER TABLE: Prevent duplicate mobile
--    Uses deleted_at for soft-delete awareness
-- ============================================================

-- Function to check vehicle owner mobile uniqueness
CREATE OR REPLACE FUNCTION check_vehicle_owner_mobile_unique()
RETURNS TRIGGER AS $$
DECLARE
    existing_count INTEGER;
BEGIN
    -- On INSERT: check if mobile already exists among active owners
    IF TG_OP = 'INSERT' THEN
        SELECT COUNT(*) INTO existing_count
        FROM vehicle_owners
        WHERE mobile = NEW.mobile
          AND (deleted_at IS NULL OR deleted_at > NOW());
        
        IF existing_count > 0 THEN
            RAISE EXCEPTION 'Vehicle owner with mobile % already exists', NEW.mobile
            USING ERRCODE = 'unique_violation';
        END IF;
    
    -- On UPDATE: only check if mobile field actually changed
    ELSIF TG_OP = 'UPDATE' AND OLD.mobile IS DISTINCT FROM NEW.mobile THEN
        SELECT COUNT(*) INTO existing_count
        FROM vehicle_owners
        WHERE mobile = NEW.mobile
          AND (deleted_at IS NULL OR deleted_at > NOW())
          AND owner_id != NEW.owner_id;
        
        IF existing_count > 0 THEN
            RAISE EXCEPTION 'Vehicle owner with mobile % already exists', NEW.mobile
            USING ERRCODE = 'unique_violation';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for vehicle owner mobile
DROP TRIGGER IF EXISTS trg_vehicle_owner_mobile_unique ON vehicle_owners;
CREATE TRIGGER trg_vehicle_owner_mobile_unique
    BEFORE INSERT OR UPDATE OF mobile ON vehicle_owners
    FOR EACH ROW
    EXECUTE FUNCTION check_vehicle_owner_mobile_unique();

-- ============================================================
-- 3. TRANSPORT_VEHICLE TABLE: Prevent duplicate vehicle_number
--    Vehicle numbers are unique identifiers - no soft delete
-- ============================================================

-- Function to check vehicle number uniqueness
CREATE OR REPLACE FUNCTION check_transport_vehicle_number_unique()
RETURNS TRIGGER AS $$
DECLARE
    existing_count INTEGER;
BEGIN
    -- On INSERT: check if vehicle_number already exists
    IF TG_OP = 'INSERT' THEN
        SELECT COUNT(*) INTO existing_count
        FROM transport_vehicles
        WHERE vehicle_number = NEW.vehicle_number;
        
        IF existing_count > 0 THEN
            RAISE EXCEPTION 'Vehicle with registration number % already exists', NEW.vehicle_number
            USING ERRCODE = 'unique_violation';
        END IF;
    
    -- On UPDATE: only check if vehicle_number field actually changed
    ELSIF TG_OP = 'UPDATE' AND OLD.vehicle_number IS DISTINCT FROM NEW.vehicle_number THEN
        SELECT COUNT(*) INTO existing_count
        FROM transport_vehicles
        WHERE vehicle_number = NEW.vehicle_number;
        
        IF existing_count > 0 THEN
            RAISE EXCEPTION 'Vehicle with registration number % already exists', NEW.vehicle_number
            USING ERRCODE = 'unique_violation';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for transport vehicle number
DROP TRIGGER IF EXISTS trg_transport_vehicle_number_unique ON transport_vehicles;
CREATE TRIGGER trg_transport_vehicle_number_unique
    BEFORE INSERT OR UPDATE OF vehicle_number ON transport_vehicles
    FOR EACH ROW
    EXECUTE FUNCTION check_transport_vehicle_number_unique();

-- ============================================================
-- 4. PARTIAL UNIQUE INDEXES for future records (PostgreSQL 15+)
--    These only apply to new records where the field is not null
--    and don't conflict with existing duplicates
-- ============================================================

-- Note: Partial unique indexes would conflict with existing duplicates.
-- The triggers above handle the duplicate prevention at write time.
-- We add indexes only for query performance on the normalized fields.

-- Index for driver mobile lookups (already exists: idx_drivers_mobile)
-- Index for driver license lookups (already exists: idx_drivers_license)
-- Index for vehicle owner mobile lookups (already exists: idx_vehicle_owner_mobile)
-- Index for transport vehicle number lookups (already exists: idx_vehicles_number)

-- ============================================================
-- 5. VALIDATION TRIGGERS: Ensure data quality on critical fields
-- ============================================================

-- Validate driver mobile format (10 digits starting with 6-9)
CREATE OR REPLACE FUNCTION validate_driver_mobile_format()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.mobile IS NOT NULL AND NEW.mobile != '' THEN
        -- Normalize: strip non-digits
        DECLARE
            normalized_mobile TEXT := REGEXP_REPLACE(NEW.mobile, '\D', '', 'g');
        BEGIN
            IF LENGTH(normalized_mobile) != 10 OR normalized_mobile !~ '^[6-9]' THEN
                RAISE EXCEPTION 'Invalid mobile number format: must be 10 digits starting with 6-9'
                USING ERRCODE = 'check_violation';
            END IF;
            -- Auto-normalize
            NEW.mobile := normalized_mobile;
        END;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_validate_driver_mobile ON drivers;
CREATE TRIGGER trg_validate_driver_mobile
    BEFORE INSERT OR UPDATE OF mobile ON drivers
    FOR EACH ROW
    EXECUTE FUNCTION validate_driver_mobile_format();

-- Validate vehicle owner mobile format
CREATE OR REPLACE FUNCTION validate_vehicle_owner_mobile_format()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.mobile IS NOT NULL AND NEW.mobile != '' THEN
        DECLARE
            normalized_mobile TEXT := REGEXP_REPLACE(NEW.mobile, '\D', '', 'g');
        BEGIN
            IF LENGTH(normalized_mobile) != 10 OR normalized_mobile !~ '^[6-9]' THEN
                RAISE EXCEPTION 'Invalid mobile number format: must be 10 digits starting with 6-9'
                USING ERRCODE = 'check_violation';
            END IF;
            NEW.mobile := normalized_mobile;
        END;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_validate_vehicle_owner_mobile ON vehicle_owners;
CREATE TRIGGER trg_validate_vehicle_owner_mobile
    BEFORE INSERT OR UPDATE OF mobile ON vehicle_owners
    FOR EACH ROW
    EXECUTE FUNCTION validate_vehicle_owner_mobile_format();

-- Validate vehicle number format (Indian format: XX00XX0000)
CREATE OR REPLACE FUNCTION validate_transport_vehicle_number_format()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.vehicle_number IS NOT NULL AND NEW.vehicle_number != '' THEN
        DECLARE
            normalized_number TEXT := UPPER(REGEXP_REPLACE(NEW.vehicle_number, '[^A-Z0-9]', '', 'g'));
        BEGIN
            -- Indian format: 2 letters, 1-2 digits, 1-3 letters, 4 digits
            IF normalized_number !~ '^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{4}$' THEN
                RAISE EXCEPTION 'Invalid vehicle number format: expected format like BR01AB1234'
                USING ERRCODE = 'check_violation';
            END IF;
            NEW.vehicle_number := normalized_number;
        END;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_validate_transport_vehicle_number ON transport_vehicles;
CREATE TRIGGER trg_validate_transport_vehicle_number
    BEFORE INSERT OR UPDATE OF vehicle_number ON transport_vehicles
    FOR EACH ROW
    EXECUTE FUNCTION validate_transport_vehicle_number_format();

-- ============================================================
-- 6. DRIVER AVAILABILITY GUARD: Prevent setting available while on active trip
-- ============================================================

CREATE OR REPLACE FUNCTION check_driver_availability_on_trip()
RETURNS TRIGGER AS $$
DECLARE
    active_trip_count INTEGER;
BEGIN
    -- Only check when status is being set to 'available' or 'is_available' = true
    IF TG_OP = 'UPDATE' THEN
        IF (NEW.status = 'available' AND OLD.status IS DISTINCT FROM 'available')
           OR (NEW.is_available = true AND OLD.is_available IS DISTINCT FROM true) THEN
            
            -- Check for operational active trips (not completed/cancelled)
            SELECT COUNT(*) INTO active_trip_count
            FROM trips
            WHERE driver_id = NEW.driver_id
              AND status IN ('DISPATCHED', 'IN_TRANSIT', 'LOADED', 'AT_LOADING_POINT', 'TO_LOADING_POINT', 'ASSIGNED');
            
            IF active_trip_count > 0 THEN
                RAISE EXCEPTION 'Cannot set driver to available: driver has % operational active trip(s)', active_trip_count
                USING ERRCODE = 'check_violation';
            END IF;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_driver_availability_guard ON drivers;
CREATE TRIGGER trg_driver_availability_guard
    BEFORE UPDATE OF status, is_available ON drivers
    FOR EACH ROW
    EXECUTE FUNCTION check_driver_availability_on_trip();

-- ============================================================
-- 7. VEHICLE ASSIGNMENT GUARD: Prevent assigning vehicle to multiple drivers
-- ============================================================

CREATE OR REPLACE FUNCTION check_vehicle_driver_assignment()
RETURNS TRIGGER AS $$
DECLARE
    existing_driver_id INTEGER;
BEGIN
    -- On vehicle assignment change
    IF TG_OP = 'UPDATE' AND OLD.driver_id IS DISTINCT FROM NEW.driver_id THEN
        -- If assigning to a new driver, check if vehicle is already assigned to another active driver
        IF NEW.driver_id IS NOT NULL THEN
            SELECT driver_id INTO existing_driver_id
            FROM drivers
            WHERE current_vehicle_id = NEW.vehicle_id
              AND driver_id != NEW.driver_id
              AND status IN ('available', 'on_trip', 'assigned');
            
            IF existing_driver_id IS NOT NULL THEN
                RAISE EXCEPTION 'Vehicle % is already assigned to driver %', NEW.vehicle_id, existing_driver_id
                USING ERRCODE = 'check_violation';
            END IF;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_vehicle_driver_assignment_guard ON transport_vehicles;
CREATE TRIGGER trg_vehicle_driver_assignment_guard
    BEFORE UPDATE OF driver_id ON transport_vehicles
    FOR EACH ROW
    EXECUTE FUNCTION check_vehicle_driver_assignment();

-- Also guard on driver side when current_vehicle_id changes
CREATE OR REPLACE FUNCTION check_driver_vehicle_assignment()
RETURNS TRIGGER AS $$
DECLARE
    existing_vehicle_id INTEGER;
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.current_vehicle_id IS DISTINCT FROM NEW.current_vehicle_id THEN
        IF NEW.current_vehicle_id IS NOT NULL THEN
            -- Check if this vehicle is already assigned to another driver
            SELECT current_vehicle_id INTO existing_vehicle_id
            FROM drivers
            WHERE current_vehicle_id = NEW.current_vehicle_id
              AND driver_id != NEW.driver_id
              AND status IN ('available', 'on_trip', 'assigned');
            
            IF existing_vehicle_id IS NOT NULL THEN
                RAISE EXCEPTION 'Vehicle % is already assigned to another driver', NEW.current_vehicle_id
                USING ERRCODE = 'check_violation';
            END IF;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_driver_vehicle_assignment_guard ON drivers;
CREATE TRIGGER trg_driver_vehicle_assignment_guard
    BEFORE UPDATE OF current_vehicle_id ON drivers
    FOR EACH ROW
    EXECUTE FUNCTION check_driver_vehicle_assignment();

-- ============================================================
-- 8. OWNER DELETE PROTECTION: Prevent deletion when dependencies exist
-- ============================================================

CREATE OR REPLACE FUNCTION check_vehicle_owner_delete_dependencies()
RETURNS TRIGGER AS $$
DECLARE
    dep_count INTEGER;
    dep_type TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        -- Check vehicles
        SELECT COUNT(*) INTO dep_count FROM transport_vehicles WHERE owner_id = OLD.owner_id;
        IF dep_count > 0 THEN
            RAISE EXCEPTION 'Cannot delete owner: % vehicle(s) depend on this owner', dep_count
            USING ERRCODE = 'foreign_key_violation';
        END IF;
        
        -- Check drivers
        SELECT COUNT(*) INTO dep_count FROM drivers WHERE transport_owner_id = OLD.owner_id;
        IF dep_count > 0 THEN
            RAISE EXCEPTION 'Cannot delete owner: % driver(s) depend on this owner', dep_count
            USING ERRCODE = 'foreign_key_violation';
        END IF;
        
        -- Check bookings
        SELECT COUNT(*) INTO dep_count FROM bookings WHERE vehicle_owner_id = OLD.owner_id;
        IF dep_count > 0 THEN
            RAISE EXCEPTION 'Cannot delete owner: % booking(s) depend on this owner', dep_count
            USING ERRCODE = 'foreign_key_violation';
        END IF;
        
        -- Check trips
        SELECT COUNT(*) INTO dep_count FROM trips WHERE transport_owner_id = OLD.owner_id;
        IF dep_count > 0 THEN
            RAISE EXCEPTION 'Cannot delete owner: % trip(s) depend on this owner', dep_count
            USING ERRCODE = 'foreign_key_violation';
        END IF;
        
        -- Check vehicle hires
        SELECT COUNT(*) INTO dep_count FROM vehicle_hires WHERE vendor_id = OLD.owner_id;
        IF dep_count > 0 THEN
            RAISE EXCEPTION 'Cannot delete owner: % vehicle hire(s) depend on this owner', dep_count
            USING ERRCODE = 'foreign_key_violation';
        END IF;
        
        -- Check applications
        SELECT COUNT(*) INTO dep_count FROM partner_applications WHERE vehicle_owner_id = OLD.owner_id;
        IF dep_count > 0 THEN
            RAISE EXCEPTION 'Cannot delete owner: % partner application(s) depend on this owner', dep_count
            USING ERRCODE = 'foreign_key_violation';
        END IF;
    END IF;
    
    RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_vehicle_owner_delete_protect ON vehicle_owners;
CREATE TRIGGER trg_vehicle_owner_delete_protect
    BEFORE DELETE ON vehicle_owners
    FOR EACH ROW
    EXECUTE FUNCTION check_vehicle_owner_delete_dependencies();