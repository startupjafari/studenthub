-- CreateEnum
CREATE TYPE "RoomKind" AS ENUM ('AUDITORIUM', 'LAB', 'SPORT_HALL', 'LIBRARY', 'ASSEMBLY_HALL', 'ADMIN_OFFICE', 'DEAN_OFFICE', 'ACCOUNTING', 'CANTEEN', 'DORMITORY', 'OTHER');
-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "building" TEXT,
ADD COLUMN     "floor" INTEGER,
ADD COLUMN     "info" TEXT,
ADD COLUMN     "kind" "RoomKind" NOT NULL DEFAULT 'AUDITORIUM',
ADD COLUMN     "open_hours" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "qr_code" TEXT,
ADD COLUMN     "qr_issued_at" TIMESTAMP(3);
-- CreateIndex
CREATE UNIQUE INDEX "rooms_qr_code_key" ON "rooms"("qr_code");
