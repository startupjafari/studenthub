// Сидер справочника КАТО (docs/PROJECT.md §6.2). Идемпотентен и нужен не только в dev:
// без него `University.city` не во что резолвить, поэтому запускается и при развёртывании.
//
// Данные: prisma/data/kato.json — генерируется из выгрузки stat.gov.kz скриптом
// scripts/gen-kato.mjs (там же перечислены дефекты источника, которые он чинит).
//
// Запуск: pnpm db:seed:kato
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PrismaClient, Prisma } from '@prisma/client'

const prisma = new PrismaClient()
const DATA = fileURLToPath(new URL('./data/kato.json', import.meta.url))
const CHUNK = 500

async function main() {
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

  const [total, regions, cities] = await Promise.all([
    prisma.katoUnit.count(),
    prisma.katoUnit.count({ where: { kind: 'REGION' } }),
    prisma.katoUnit.count({ where: { kind: 'CITY' } }),
  ])
  console.log(
    `КАТО: записано ${written}, в таблице ${total} (областей ${regions}, городов ${cities})`,
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
