-- CreateTable
CREATE TABLE "campuses" (
    "id" TEXT NOT NULL,
    "university_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "geo_anchor" JSONB,
    "published_version_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "campuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campus_buildings" (
    "id" TEXT NOT NULL,
    "campus_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "outline" JSONB NOT NULL,
    "transform" JSONB NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "campus_buildings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campus_floors" (
    "id" TEXT NOT NULL,
    "building_id" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'regular',
    "elevation_mm" INTEGER NOT NULL,
    "height_mm" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campus_floors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campus_floor_plans" (
    "floor_id" TEXT NOT NULL,
    "format" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "document" JSONB NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campus_floor_plans_pkey" PRIMARY KEY ("floor_id")
);

-- CreateTable
CREATE TABLE "campus_floor_plan_snapshots" (
    "id" TEXT NOT NULL,
    "floor_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "format" INTEGER NOT NULL,
    "document" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campus_floor_plan_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campus_site_plans" (
    "campus_id" TEXT NOT NULL,
    "format" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "document" JSONB NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campus_site_plans_pkey" PRIMARY KEY ("campus_id")
);

-- CreateTable
CREATE TABLE "campus_versions" (
    "id" TEXT NOT NULL,
    "campus_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "note" TEXT,
    "manifest" JSONB NOT NULL,
    "nav_graph" JSONB,
    "published_by_id" TEXT NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campus_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campus_version_floors" (
    "version_id" TEXT NOT NULL,
    "floor_id" TEXT NOT NULL,
    "format" INTEGER NOT NULL,
    "document" JSONB NOT NULL,

    CONSTRAINT "campus_version_floors_pkey" PRIMARY KEY ("version_id","floor_id")
);

-- CreateTable
CREATE TABLE "campus_space_index" (
    "version_id" TEXT NOT NULL,
    "space_id" TEXT NOT NULL,
    "building_id" TEXT NOT NULL,
    "floor_id" TEXT NOT NULL,
    "room_id" TEXT,
    "number" TEXT,
    "name" TEXT,
    "kind" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "center_x" INTEGER NOT NULL,
    "center_y" INTEGER NOT NULL,
    "area_mm2" BIGINT NOT NULL,
    "universityId" TEXT,

    CONSTRAINT "campus_space_index_pkey" PRIMARY KEY ("version_id","space_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campuses_published_version_id_key" ON "campuses"("published_version_id");

-- CreateIndex
CREATE INDEX "campuses_university_id_idx" ON "campuses"("university_id");

-- CreateIndex
CREATE INDEX "campus_buildings_campus_id_idx" ON "campus_buildings"("campus_id");

-- CreateIndex
CREATE UNIQUE INDEX "campus_floors_building_id_level_key" ON "campus_floors"("building_id", "level");

-- CreateIndex
CREATE INDEX "campus_floor_plan_snapshots_floor_id_created_at_idx" ON "campus_floor_plan_snapshots"("floor_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "campus_versions_campus_id_number_key" ON "campus_versions"("campus_id", "number");

-- CreateIndex
CREATE INDEX "campus_space_index_version_id_number_idx" ON "campus_space_index"("version_id", "number");

-- CreateIndex
CREATE INDEX "campus_space_index_room_id_idx" ON "campus_space_index"("room_id");

-- CreateIndex
CREATE UNIQUE INDEX "campus_space_index_version_id_room_id_key" ON "campus_space_index"("version_id", "room_id");

-- AddForeignKey
ALTER TABLE "campuses" ADD CONSTRAINT "campuses_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campus_buildings" ADD CONSTRAINT "campus_buildings_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campus_floors" ADD CONSTRAINT "campus_floors_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "campus_buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campus_floor_plans" ADD CONSTRAINT "campus_floor_plans_floor_id_fkey" FOREIGN KEY ("floor_id") REFERENCES "campus_floors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campus_site_plans" ADD CONSTRAINT "campus_site_plans_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campus_versions" ADD CONSTRAINT "campus_versions_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campus_version_floors" ADD CONSTRAINT "campus_version_floors_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "campus_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campus_space_index" ADD CONSTRAINT "campus_space_index_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "campus_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campus_space_index" ADD CONSTRAINT "campus_space_index_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campus_space_index" ADD CONSTRAINT "campus_space_index_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "universities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
