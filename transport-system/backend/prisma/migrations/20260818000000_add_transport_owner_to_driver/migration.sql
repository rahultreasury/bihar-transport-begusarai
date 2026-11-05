-- Add transport_owner_id to drivers table
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "transport_owner_id" INTEGER;

-- Add foreign key constraint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_transport_owner_id_fkey" 
  FOREIGN KEY ("transport_owner_id") REFERENCES "vehicle_owners"("owner_id") 
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Create index for transport_owner_id
CREATE INDEX IF NOT EXISTS "idx_drivers_transport_owner" ON "drivers"("transport_owner_id");
