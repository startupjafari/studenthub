// Оркестратор генератора вузов: план прогона, пул воркеров, маркеры, отчёт.
//
// Вызывается из prisma/seed.mjs после демо-данных. Демо-вуз генератор не трогает
// (см. lib/ids.mjs) — он создаёт свои вузы u001…uN.
//
// Порядок внутри вуза важен и определяется внешними ключами: структура → люди →
// (следующие шаги эпика) академика → контент. Между этапами буфер writer'а
// дописывается, иначе FK ссылается на строку, которой в БД ещё нет.

import { fileURLToPath } from 'node:url'
import { loadCities } from './data/universities.mjs'
import { universityId } from './lib/ids.mjs'
import { clearMarkers, loadDoneUniversities, markUniversityDone } from './lib/marker.mjs'
import { runPool } from './lib/pool.mjs'
import { createProgress } from './lib/progress.mjs'
import { universityRandom } from './lib/rng.mjs'
import { createWriter } from './lib/writer.mjs'
import { seedPeople } from './steps/30-people.mjs'
import { planUniversity, seedStructure } from './steps/20-structure.mjs'

const KATO_PATH = fileURLToPath(new URL('../data/kato.json', import.meta.url))

// Сколько строк ожидается от вуза — только для оценки объёма в логе перед прогоном.
function estimateRows(plan) {
  const teachers = plan.faculties.reduce((sum, f) => sum + f.teacherCount, 0)
  const staff = plan.faculties.length + 3
  // Пользователь + его настройки уведомлений + структура.
  return (plan.students + teachers + staff) * 2 + plan.groupCount + plan.roomCount + 40
}

export async function seedUniversities(prisma, { config, passwordHash }) {
  const cities = loadCities(KATO_PATH)
  const katoCount = await prisma.katoUnit.count()
  if (katoCount === 0) {
    // Не падаем: города в University.city хранятся кодом и без справочника, но селект
    // «Город» в интерфейсе будет пустой — об этом надо сказать прямо.
    console.log('  ВНИМАНИЕ: справочник КАТО пуст — сначала `pnpm db:seed:kato`.')
  }

  const indices = []
  for (let i = config.from; i <= config.to; i += 1) indices.push(i)

  if (config.force) await clearMarkers(prisma, indices.map(universityId))
  const done = await loadDoneUniversities(prisma)

  // Оценка объёма до старта: на полном масштабе прогон идёт десятки минут, и знать
  // порядок величины заранее полезнее, чем узнать его через полчаса.
  const estimate = indices.reduce(
    (sum, index) => sum + estimateRows(planUniversity(index, universityRandom(index), config)),
    0,
  )
  console.log(
    `Генератор вузов: ${indices.length} шт. (${config.from}..${config.to}), ` +
      `параллельно ${config.concurrency}, ожидается ~${estimate.toLocaleString('ru-RU')} строк`,
  )

  const progress = createProgress({ total: indices.length, label: 'Вузы' })
  const counts = {}

  await runPool(indices, config.concurrency, async (index) => {
    const uniId = universityId(index)
    if (done.has(uniId)) {
      progress.skip(uniId)
      return
    }

    const random = universityRandom(index)
    // Writer на вуз: буферы не должны пересекаться между параллельными воркерами.
    const writer = createWriter(prisma, { chunkSize: config.chunkSize })
    const ctx = { index, random, config: { ...config, cities }, passwordHash }

    const structure = await seedStructure(prisma, writer, ctx)
    const people = await seedPeople(prisma, writer, { ...ctx, structure })
    await writer.flush()

    await markUniversityDone(prisma, uniId, {
      rows: writer.written,
      students: structure.plan.students,
      faculties: structure.faculties.length,
      groups: structure.plan.groupCount,
    })

    for (const [model, count] of Object.entries(writer.counts)) {
      counts[model] = (counts[model] ?? 0) + count
    }
    progress.step(`${uniId} ${structure.profile.name}`, writer.written)
    // people пока нужен только следующим шагам эпика; здесь — чтобы линтер видел связь.
    void people
  })

  progress.report(counts)
  return counts
}
