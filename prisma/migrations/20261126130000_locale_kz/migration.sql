-- Казахский язык в приложении — `kz`, а не ISO 639-1 `kk` (docs/PROJECT.md «Язык пользователя»).
-- `kk` остаётся только на границе с платформой (Intl, <html lang>, Accept-Language) — это код,
-- а не данные, в базе его не будет.
--
-- Колонки *_kk переименовываются на месте, данные не теряются. Индексов, уникальных
-- ограничений, внешних ключей и CHECK на этих колонках и на значении 'kk' в истории миграций
-- нет — переименовывать больше нечего.

-- RenameColumn: каталог услуг
ALTER TABLE "application_categories" RENAME COLUMN "name_kk" TO "name_kz";
ALTER TABLE "application_services" RENAME COLUMN "name_kk" TO "name_kz";
ALTER TABLE "application_services" RENAME COLUMN "description_kk" TO "description_kz";
ALTER TABLE "application_services" RENAME COLUMN "instructions_kk" TO "instructions_kz";
ALTER TABLE "service_requirements" RENAME COLUMN "title_kk" TO "title_kz";
ALTER TABLE "service_form_fields" RENAME COLUMN "label_kk" TO "label_kz";
ALTER TABLE "service_form_fields" RENAME COLUMN "placeholder_kk" TO "placeholder_kz";

-- RenameColumn: справочник КАТО
ALTER TABLE "kato_units" RENAME COLUMN "name_kk" TO "name_kz";

-- RenameColumn: состояние платформы (техработы и баннер)
ALTER TABLE "platform_state" RENAME COLUMN "maintenance_message_kk" TO "maintenance_message_kz";
ALTER TABLE "platform_state" RENAME COLUMN "banner_text_kk" TO "banner_text_kz";

-- Данные: сохранённый код языка интерфейса и языка шаблона документов.
UPDATE "users" SET "locale" = 'kz' WHERE "locale" = 'kk';
UPDATE "document_templates" SET "locale" = 'kz' WHERE "locale" = 'kk';

-- Данные: владение языками в профиле и в вакансии — свободный список, но сид и часть
-- пользователей писали туда код `kk`. Меняется только элемент, равный коду целиком.
UPDATE "users" SET "languages" = array_replace("languages", 'kk', 'kz') WHERE 'kk' = ANY ("languages");
UPDATE "vacancies" SET "languages" = array_replace("languages", 'kk', 'kz') WHERE 'kk' = ANY ("languages");

-- Данные: варианты полей выбора хранятся в JSONB как [{ value, labelRu, labelKk, labelEn }].
UPDATE "service_form_fields" AS f
SET "options" = (
    SELECT jsonb_agg(
        CASE
            WHEN jsonb_typeof(o.elem) = 'object' AND (o.elem -> 'labelKk') IS NOT NULL
                THEN (o.elem - 'labelKk') || jsonb_build_object('labelKz', o.elem -> 'labelKk')
            ELSE o.elem
        END
        ORDER BY o.ord
    )
    FROM jsonb_array_elements(f."options") WITH ORDINALITY AS o(elem, ord)
)
WHERE jsonb_typeof(f."options") = 'array'
  AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(f."options") AS e(elem)
      WHERE jsonb_typeof(e.elem) = 'object' AND (e.elem -> 'labelKk') IS NOT NULL
  );

-- Данные: снимок «как было» в журнале платформы. По нему работает «Отменить»
-- (PlatformService.undoLast): ключи снимка — имена полей PlatformState, и со старыми
-- именами откат упал бы на неизвестном поле.
UPDATE "audit_logs"
SET "metadata" = jsonb_set(
    "metadata",
    '{before}',
    (("metadata" -> 'before') - 'maintenanceMessageKk')
        || jsonb_build_object('maintenanceMessageKz', ("metadata" -> 'before') -> 'maintenanceMessageKk')
)
WHERE "entity" = 'PlatformState'
  AND jsonb_typeof("metadata" -> 'before') = 'object'
  AND (("metadata" -> 'before') -> 'maintenanceMessageKk') IS NOT NULL;

UPDATE "audit_logs"
SET "metadata" = jsonb_set(
    "metadata",
    '{before}',
    (("metadata" -> 'before') - 'bannerTextKk')
        || jsonb_build_object('bannerTextKz', ("metadata" -> 'before') -> 'bannerTextKk')
)
WHERE "entity" = 'PlatformState'
  AND jsonb_typeof("metadata" -> 'before') = 'object'
  AND (("metadata" -> 'before') -> 'bannerTextKk') IS NOT NULL;
