-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('PENDING', 'PREPARING', 'DRIVER_RESERVED', 'VEHICLE_RESERVED', 'QUOTE_SENT', 'WAITING_CUSTOMER_APPROVAL', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'CONVERTED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('PENDING', 'GENERATED', 'PAID', 'CANCELLED');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "quote_accepted_at" TIMESTAMP(3),
ADD COLUMN     "quote_rejected_at" TIMESTAMP(3),
ADD COLUMN     "quote_remarks" TEXT,
ADD COLUMN     "quote_sent_at" TIMESTAMP(3),
ADD COLUMN     "quote_status" TEXT DEFAULT 'PENDING',
ADD COLUMN     "quote_valid_until" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "reservations" (
    "reservation_id" SERIAL NOT NULL,
    "booking_id" INTEGER NOT NULL,
    "driver_id" INTEGER,
    "vehicle_id" INTEGER,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "converted_at" TIMESTAMP(3),
    "reserved_by" INTEGER,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("reservation_id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "invoice_id" SERIAL NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "booking_id" INTEGER NOT NULL,
    "final_price" DOUBLE PRECISION NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "goods_amount" DOUBLE PRECISION,
    "vehicle_charge" DOUBLE PRECISION,
    "extra_charges" DOUBLE PRECISION DEFAULT 0,
    "discount" DOUBLE PRECISION DEFAULT 0,
    "total_amount" DOUBLE PRECISION,
    "tax_amount" DOUBLE PRECISION DEFAULT 0,
    "grand_total" DOUBLE PRECISION,
    "issued_at" TIMESTAMP(3),
    "due_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("invoice_id")
);

-- CreateIndex
CREATE INDEX "idx_reservations_booking" ON "reservations"("booking_id");

-- CreateIndex
CREATE INDEX "idx_reservations_driver" ON "reservations"("driver_id");

-- CreateIndex
CREATE INDEX "idx_reservations_vehicle" ON "reservations"("vehicle_id");

-- CreateIndex
CREATE INDEX "idx_reservations_status" ON "reservations"("status");

-- CreateIndex
CREATE INDEX "idx_reservations_expires" ON "reservations"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");

-- CreateIndex
CREATE INDEX "idx_invoices_number" ON "invoices"("invoice_number");

-- CreateIndex
CREATE INDEX "idx_invoices_booking" ON "invoices"("booking_id");

-- CreateIndex
CREATE INDEX "idx_invoices_status" ON "invoices"("status");

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("booking_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("driver_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "transport_vehicles"("vehicle_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("booking_id") ON DELETE CASCADE ON UPDATE CASCADE;
