-- CreateTable
CREATE TABLE "schedules" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pairs" (
    "id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "teacher_id" TEXT,
    "room_id" TEXT,
    "day_of_week" INTEGER NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "week_type" "WeekType" NOT NULL DEFAULT 'BOTH',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pairs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_changes" (
    "id" TEXT NOT NULL,
    "pair_id" TEXT NOT NULL,
    "type" "ScheduleChangeType" NOT NULL,
    "date" DATE NOT NULL,
    "new_room_id" TEXT,
    "new_teacher_id" TEXT,
    "new_start_time" TEXT,
    "new_end_time" TEXT,
    "note" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "schedules_group_id_idx" ON "schedules"("group_id");

-- CreateIndex
CREATE INDEX "pairs_schedule_id_idx" ON "pairs"("schedule_id");

-- CreateIndex
CREATE INDEX "pairs_group_id_day_of_week_idx" ON "pairs"("group_id", "day_of_week");

-- CreateIndex
CREATE INDEX "pairs_teacher_id_day_of_week_idx" ON "pairs"("teacher_id", "day_of_week");

-- CreateIndex
CREATE INDEX "pairs_room_id_day_of_week_idx" ON "pairs"("room_id", "day_of_week");

-- CreateIndex
CREATE INDEX "schedule_changes_pair_id_idx" ON "schedule_changes"("pair_id");

-- CreateIndex
CREATE INDEX "schedule_changes_date_idx" ON "schedule_changes"("date");

-- CreateIndex
CREATE INDEX "schedule_changes_created_by_id_idx" ON "schedule_changes"("created_by_id");

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairs" ADD CONSTRAINT "pairs_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairs" ADD CONSTRAINT "pairs_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairs" ADD CONSTRAINT "pairs_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairs" ADD CONSTRAINT "pairs_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_changes" ADD CONSTRAINT "schedule_changes_pair_id_fkey" FOREIGN KEY ("pair_id") REFERENCES "pairs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_changes" ADD CONSTRAINT "schedule_changes_new_room_id_fkey" FOREIGN KEY ("new_room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_changes" ADD CONSTRAINT "schedule_changes_new_teacher_id_fkey" FOREIGN KEY ("new_teacher_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_changes" ADD CONSTRAINT "schedule_changes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

