-- CreateEnum
CREATE TYPE "CameraStatus" AS ENUM ('UNKNOWN', 'ONLINE', 'OFFLINE', 'AUTH_FAILED');

-- CreateTable
CREATE TABLE "camera_agents" (
    "id" TEXT NOT NULL,
    "university_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "public_key" TEXT,
    "version" TEXT,
    "last_seen_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "camera_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cameras" (
    "id" TEXT NOT NULL,
    "university_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "room_id" TEXT,
    "name" TEXT NOT NULL,
    "stream_url" TEXT NOT NULL,
    "credentials_sealed" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "CameraStatus" NOT NULL DEFAULT 'UNKNOWN',
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cameras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "camera_settings" (
    "university_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "camera_settings_pkey" PRIMARY KEY ("university_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "camera_agents_token_hash_key" ON "camera_agents"("token_hash");

-- CreateIndex
CREATE INDEX "camera_agents_university_id_idx" ON "camera_agents"("university_id");

-- CreateIndex
CREATE INDEX "camera_agents_created_by_id_idx" ON "camera_agents"("created_by_id");

-- CreateIndex
CREATE INDEX "cameras_university_id_idx" ON "cameras"("university_id");

-- CreateIndex
CREATE INDEX "cameras_agent_id_idx" ON "cameras"("agent_id");

-- CreateIndex
CREATE INDEX "cameras_room_id_idx" ON "cameras"("room_id");

-- CreateIndex
CREATE INDEX "camera_settings_updated_by_id_idx" ON "camera_settings"("updated_by_id");

-- AddForeignKey
ALTER TABLE "camera_agents" ADD CONSTRAINT "camera_agents_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "camera_agents" ADD CONSTRAINT "camera_agents_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cameras" ADD CONSTRAINT "cameras_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cameras" ADD CONSTRAINT "cameras_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "camera_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cameras" ADD CONSTRAINT "cameras_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "camera_settings" ADD CONSTRAINT "camera_settings_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "camera_settings" ADD CONSTRAINT "camera_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

