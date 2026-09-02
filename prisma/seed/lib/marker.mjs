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

// Снять маркеры (SEED_FORCE): вузы будут перегенерированы на этом же прогоне.
export async function clearMarkers(prisma, uniIds) {
  await prisma.auditLog.deleteMany({
    where: { action: ACTION, entityId: { in: uniIds } },
  })
}
