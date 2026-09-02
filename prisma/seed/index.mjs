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
import { planUniversity, seedStructure } from './steps/20-structure.mjs'
import { seedPeople } from './steps/30-people.mjs'
import { seedAcademics } from './steps/40-academics.mjs'
import { seedSocial } from './steps/50-social.mjs'
import { seedProfileContent } from './steps/55-profile-content.mjs'
import { seedChats } from './steps/60-chats.mjs'
import { seedServices } from './steps/70-services.mjs'
import { seedCareer } from './steps/80-career.mjs'

const KATO_PATH = fileURLToPath(new URL('../data/kato.json', import.meta.url))

// Сколько строк ожидается от вуза — только для оценки объёма в логе перед прогоном.
// Основную массу дают посещаемость (пары × недели × студенты) и журнал оценок.
function estimateRows(plan) {
  const teachers = plan.faculties.reduce((sum, f) => sum + f.teacherCount, 0)
  const people = (plan.students + teachers + plan.faculties.length + 3) * 2
  const subjectsPerGroup = 6
  const courses = plan.groupCount * subjectsPerGroup * 2
  const grades = courses * 3 * (1 + 25)
  const attendance = plan.groupCount * 3 * 12 * 25
  const assignments = (courses / 2) * (1 + 25 * 0.8)
  const exams = courses * (1 + 25)
  return people + plan.groupCount + plan.roomCount + courses + grades + attendance + assignments + exams // prettier-ignore
}

export async function seedUniversities(prisma, { config, passwordHash, pool, companies }) {
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
    const ctx = { index, random, config: { ...config, cities }, passwordHash, pool, companies }

    const structure = await seedStructure(prisma, writer, ctx)
    const people = await seedPeople(prisma, writer, { ...ctx, structure })
    await seedAcademics(prisma, writer, { ...ctx, structure, people })
    await seedSocial(prisma, writer, { ...ctx, structure, people })
    await seedProfileContent(prisma, writer, { ...ctx, structure, people })
    await seedChats(prisma, writer, { ...ctx, structure, people })
    await seedServices(prisma, writer, { ...ctx, structure, people })
    await seedCareer(prisma, writer, { ...ctx, structure, people })
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
  })

  progress.report(counts)
  return counts
}
