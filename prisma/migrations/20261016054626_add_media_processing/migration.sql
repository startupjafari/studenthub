-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('NONE', 'PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "MediaVariantKind" AS ENUM ('IMAGE', 'POSTER', 'HLS');

-- AlterTable
ALTER TABLE "files" ADD COLUMN     "duration_ms" INTEGER,
ADD COLUMN     "media_status" "MediaStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "placeholder" TEXT,
ADD COLUMN     "processed_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "file_variants" (
    "id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "kind" "MediaVariantKind" NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "bitrate" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_variants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "file_variants_file_id_idx" ON "file_variants"("file_id");

-- CreateIndex
CREATE UNIQUE INDEX "file_variants_file_id_kind_width_key" ON "file_variants"("file_id", "kind", "width");

-- CreateIndex
CREATE INDEX "files_media_status_created_at_idx" ON "files"("media_status", "created_at");

-- AddForeignKey
ALTER TABLE "file_variants" ADD CONSTRAINT "file_variants_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
