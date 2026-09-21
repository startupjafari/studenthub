-- CreateTable
CREATE TABLE "platform_state" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "maintenance_until" TIMESTAMP(3),
    "maintenance_message_ru" TEXT,
    "maintenance_message_kk" TEXT,
    "maintenance_message_en" TEXT,
    "banner_until" TIMESTAMP(3),
    "banner_text_ru" TEXT,
    "banner_text_kk" TEXT,
    "banner_text_en" TEXT,
    "banner_level" TEXT,
    "disabled_sections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "announced_version" TEXT,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_state_pkey" PRIMARY KEY ("id")
);
