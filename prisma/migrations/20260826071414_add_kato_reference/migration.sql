-- CreateEnum
CREATE TYPE "KatoKind" AS ENUM ('REGION', 'DISTRICT', 'ADMIN', 'CITY', 'SETTLEMENT', 'VILLAGE', 'STATION', 'OTHER');

-- CreateTable
CREATE TABLE "kato_units" (
    "code" CHAR(9) NOT NULL,
    "kind" "KatoKind" NOT NULL,
    "name_ru" TEXT NOT NULL,
    "name_kk" TEXT NOT NULL,
    "parent_code" CHAR(9),
    "region_code" CHAR(9) NOT NULL,

    CONSTRAINT "kato_units_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "kato_units_kind_idx" ON "kato_units"("kind");

-- CreateIndex
CREATE INDEX "kato_units_parent_code_idx" ON "kato_units"("parent_code");

-- CreateIndex
CREATE INDEX "kato_units_region_code_idx" ON "kato_units"("region_code");

-- AddForeignKey
ALTER TABLE "kato_units" ADD CONSTRAINT "kato_units_parent_code_fkey" FOREIGN KEY ("parent_code") REFERENCES "kato_units"("code") ON DELETE SET NULL ON UPDATE CASCADE;
