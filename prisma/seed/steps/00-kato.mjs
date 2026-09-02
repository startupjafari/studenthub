// Шаг «справочник КАТО» (классификатор административно-территориальных объектов РК).
//
// Это НЕ демо-данные: без справочника `University.city` (там хранится 9-значный код)
// не во что резолвить, и селект «Город» отдаёт пустой список. Поэтому шаг выполняется
// и при развёртывании, а не только в dev.
//
// Данные: prisma/seed/data/kato.json — генерируется из выгрузки stat.gov.kz скриптом
// scripts/gen-kato.mjs (там же перечислены дефекты источника, которые он чинит).

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Prisma } from '@prisma/client'

const DATA = fileURLToPath(new URL('../data/kato.json', import.meta.url))
const CHUNK = 500

export async function seedKato(prisma) {
  const items = JSON.parse(readFileSync(DATA, 'utf8'))
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(`Справочник КАТО пуст или повреждён: ${DATA}`)
  }

  // Порядок важен: parent_code ссылается на эту же таблицу, а внешний ключ в Postgres
  // проверяется построчно. Код родителя всегда лексикографически меньше кода потомка
  // (младшая группа цифр обнулена), поэтому сортировка по коду гарантирует, что родитель
  // вставлен раньше. Генератор уже сортирует, здесь — страховка от правки формата данных.
  items.sort((a, b) => a.code.localeCompare(b.code))

  let written = 0
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK)
    // ON CONFLICT DO UPDATE, а не createMany({ skipDuplicates }): при обновлении выгрузки
    // (переименование города, смена подчинённости) существующие строки обязаны обновиться.
    // Все значения — параметры ($1, $2, …); enum приводится приведением типа на плейсхолдере,
    // а не подстановкой строки в SQL (BACKEND_RULES §14.4).
    const values = chunk.map(
      (e) =>
        Prisma.sql`(${e.code}, ${e.kind}::"KatoKind", ${e.nameRu}, ${e.nameKk}, ${e.parentCode}, ${e.regionCode})`,
    )
    written += await prisma.$executeRaw`
      INSERT INTO "kato_units" ("code", "kind", "name_ru", "name_kk", "parent_code", "region_code")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("code") DO UPDATE SET
        "kind"        = EXCLUDED."kind",
        "name_ru"     = EXCLUDED."name_ru",
        "name_kk"     = EXCLUDED."name_kk",
        "parent_code" = EXCLUDED."parent_code",
        "region_code" = EXCLUDED."region_code"
    `
  }

  const [total, cities] = await Promise.all([
    prisma.katoUnit.count(),
    prisma.katoUnit.count({ where: { kind: 'CITY' } }),
  ])
  console.log(`КАТО: записано ${written}, в таблице ${total} (городов ${cities})`)
  return written
}
