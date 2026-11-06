-- Онлайн-встреча события (Ф14.5): провайдер, ссылка и код доступа отдельными полями.
--
-- Три новые колонки и один перенос данных. Перенос нужен потому, что до сих пор ссылку
-- на встречу клали в `location` — в то же поле, где адрес аудитории. Онлайн-события,
-- у которых location выглядит ссылкой (http/https), получают её в meeting_url, провайдер
-- определяется по хосту, а location очищается: место и способ подключения — разные вещи.
--
-- Затрагиваются ТОЛЬКО строки с is_online = true и ссылкой в location. Офлайн-события и
-- онлайн-события с текстовым местом не меняются. Откат — вернуть location из meeting_url.

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "meeting_passcode" TEXT,
ADD COLUMN     "meeting_provider" TEXT,
ADD COLUMN     "meeting_url" TEXT;


-- Перенос ссылок из location (см. шапку).
UPDATE "events"
SET "meeting_url" = "location",
    "meeting_provider" = CASE
      WHEN "location" ~* '(^|\.)zoom\.us(/|$)' THEN 'ZOOM'
      WHEN "location" ~* '(^|//)meet\.google\.com(/|$)' THEN 'GOOGLE_MEET'
      WHEN "location" ~* 'teams\.(microsoft|live)\.com' THEN 'TEAMS'
      ELSE 'OTHER'
    END,
    "location" = NULL
WHERE "is_online" = true AND "location" ~* '^https?://';
