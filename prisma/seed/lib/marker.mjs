// Маркеры готовности вуза: чтобы повторный прогон не перегенерировал уже залитые вузы.
//
// Зачем: полный масштаб — десятки минут. Без маркеров любой повторный запуск (упал на
// 70-м вузе, дописали шаг, просто перезапустили) заново перемалывает все 100 вузов,
// даже если createMany всё пропустит по skipDuplicates: генерация строк в JS и сетевые
// round-trip'ы съедают то же время.
//
// Где храним: AuditLog. Отдельная таблица потребовала бы миграции (стоп-точка), а
// журнал аудита ровно для таких отметок и предназначен: userId nullable, metadata Json.
// Строка помечена фиксированным id, поэтому сама тоже идемпотентна.
//
// version: если поменялся генератор (добавили сущности), поднимаем версию — маркеры
// прошлых прогонов перестают совпадать, и вузы перегенерируются.

const ACTION = 'SEED_UNIVERSITY'
// Запись о прогоне целиком: одна строка на запуск, ключом служит метка (SEED_TAG).
// По ней режим cleanup находит, что именно удалять.
const RUN_ACTION = 'SEED_RUN'

export const SEED_VERSION = 1

function markerId(uniId, version = SEED_VERSION) {
  return `seed-marker-${uniId}-v${version}`
}

// Множество id вузов, уже залитых текущей версией сида.
export async function loadDoneUniversities(prisma) {
  const rows = await prisma.auditLog.findMany({
    where: { action: ACTION, id: { endsWith: `-v${SEED_VERSION}` } },
    select: { entityId: true },
    take: 5000,
  })
  return new Set(rows.map((r) => r.entityId).filter(Boolean))
}

export async function markUniversityDone(prisma, uniId, stats) {
  const id = markerId(uniId)
  const data = {
    action: ACTION,
    entity: 'University',
    entityId: uniId,
    metadata: { version: SEED_VERSION, ...stats },
  }
  await prisma.auditLog.upsert({ where: { id }, update: data, create: { id, ...data } })
}

/**
 * Вузы, залитые прогоном с этой меткой.
 *
 * Метка лежит в metadata маркера, а не в отдельной колонке: колонка означала бы
 * миграцию ради служебного поля сида. Фильтр по JSON-пути Postgres умеет.
 */
export async function loadUniversitiesByTag(prisma, tag) {
  const rows = await prisma.auditLog.findMany({
    where: { action: ACTION, metadata: { path: ['tag'], equals: tag } },
    select: { entityId: true },
    take: 5000,
  })
  return rows.map((r) => r.entityId).filter(Boolean)
}

/**
 * Запись о прогоне: что за метка, чем запускали и сколько получилось. Это и есть
 * манифест — без него на общей с продом базе нельзя отличить свои строки от чужих.
 */
export async function recordRun(prisma, tag, summary) {
  const id = `seed-run-${tag}`
  const data = {
    action: RUN_ACTION,
    entity: 'Seed',
    entityId: tag,
    metadata: { version: SEED_VERSION, ...summary },
  }
  await prisma.auditLog.upsert({ where: { id }, update: data, create: { id, ...data } })
}

/** Убрать манифест и маркеры прогона — последним шагом уборки. */
export async function clearRun(prisma, tag, uniIds) {
  await prisma.auditLog.deleteMany({ where: { action: ACTION, entityId: { in: uniIds } } })
  await prisma.auditLog.deleteMany({ where: { action: RUN_ACTION, entityId: tag } })
}

// Снять маркеры (SEED_FORCE): вузы будут перегенерированы на этом же прогоне.
export async function clearMarkers(prisma, uniIds) {
  await prisma.auditLog.deleteMany({
    where: { action: ACTION, entityId: { in: uniIds } },
  })
}
