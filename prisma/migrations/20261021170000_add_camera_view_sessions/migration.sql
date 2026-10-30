-- CreateTable
CREATE TABLE "camera_view_sessions" (
    "id" TEXT NOT NULL,
    "university_id" TEXT NOT NULL,
    "camera_id" TEXT,
    "camera_name" TEXT NOT NULL,
    "user_id" TEXT,
    "user_name" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "camera_view_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "camera_view_sessions_university_id_started_at_idx" ON "camera_view_sessions"("university_id", "started_at");

-- CreateIndex
CREATE INDEX "camera_view_sessions_camera_id_idx" ON "camera_view_sessions"("camera_id");

-- CreateIndex
CREATE INDEX "camera_view_sessions_user_id_last_seen_at_idx" ON "camera_view_sessions"("user_id", "last_seen_at");

-- AddForeignKey
ALTER TABLE "camera_view_sessions" ADD CONSTRAINT "camera_view_sessions_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "camera_view_sessions" ADD CONSTRAINT "camera_view_sessions_camera_id_fkey" FOREIGN KEY ("camera_id") REFERENCES "cameras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "camera_view_sessions" ADD CONSTRAINT "camera_view_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

