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

const KATO_PATH = fileURLToPath(new URL('./data/kato.json', import.meta.url))

// Оценка объёма вуза — только для строки в логе перед прогоном, чтобы порядок величины
// был известен заранее, а не через полчаса.
//
// Базовая часть (структура, академика, документы, заявки, чаты, карьера) калибрована
// замером: 165 строк на студента. Расписывать вклад каждой из сорока моделей смысла
// нет — точности у оценки всё равно нет, слишком много случайных величин. А вот
// контент на пользователя считаем из конфига: он задаётся ручками и меняет итог в
// разы (60 постов и 55 опросов на человека — это больше половины всех строк).
const BASE_ROWS_PER_STUDENT = 165
const OPTIONS_PER_POLL = 3.5

function contentRowsPerUser(config) {
  const avg = ([min, max]) => (min + max) / 2
  const posts = avg(config.postsPerUser)
  const articles = avg(config.articlesPerUser)
  const polls = avg(config.pollsPerUser)
  const votes = polls * (config.pollVotesMax / 2)
  return posts + articles + polls * (1 + OPTIONS_PER_POLL) + votes + config.postImagesPerUser
}

function estimateRows(plan, config) {
  return Math.round(plan.students * (BASE_ROWS_PER_STUDENT + contentRowsPerUser(config)))
}

export async function seedUniversities(prisma, { config, passwordHash, pool, companies, storage }) {
  const cities = loadCities(KATO_PATH)
  const katoCount = await prisma.katoUnit.count()
  if (katoCount === 0) {
    // Не падаем: города в University.city хранятся кодом и без справочника, но селект
    // «Город» в интерфейсе будет пустой — об этом надо сказать прямо.
    console.log('  ВНИМАНИЕ: справочник КАТО пуст (шаг kato пропущен?).')
  }

  const indices = []
  for (let i = config.from; i <= config.to; i += 1) indices.push(i)

  if (config.force) await clearMarkers(prisma, indices.map(universityId))
  const done = await loadDoneUniversities(prisma)

  // Оценка объёма до старта: на полном масштабе прогон идёт десятки минут, и знать
  // порядок величины заранее полезнее, чем узнать его через полчаса.
  const estimate = indices.reduce(
    (sum, index) =>
      sum + estimateRows(planUniversity(index, universityRandom(index), config), config),
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
    const ctx = {
      index,
      random,
      config: { ...config, cities },
      passwordHash,
      pool,
      companies,
      storage,
    }

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
