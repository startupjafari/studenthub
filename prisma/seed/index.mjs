// Оркестратор генератора вузов: план прогона, пул воркеров, маркеры, отчёт.
//
// Вызывается из prisma/seed.mjs после демо-данных. Демо-вуз генератор не трогает
// (см. lib/ids.mjs) — он создаёт свои вузы u001…uN.
//
// Порядок внутри вуза важен и определяется внешними ключами: структура → люди →
// (следующие шаги эпика) академика → контент. Между этапами буфер writer'а
// дописывается, иначе FK ссылается на строку, которой в БД ещё нет.

import { fileURLToPath } from 'node:url'
import { loadCities, resolveKzUniversities } from './data/universities.mjs'
import { universityId } from './lib/ids.mjs'
import { clearMarkers, loadDoneUniversities, markUniversityDone, recordRun } from './lib/marker.mjs'
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
// Байт на строку в среднем по всем таблицам, включая индексы. Замер: полный прогон —
// 21 млн строк и ~32 ГБ базы. Оценка грубая (строка чата и строка посещаемости весят
// по-разному), но её задача одна: дать число, сопоставимое с размером тома. Строки с
// размером диска не сравнить, а гигабайты — можно.
const BYTES_PER_ROW = 1600

function contentRowsPerUser(config) {
  const avg = ([min, max]) => (min + max) / 2
  const posts = avg(config.postsPerUser)
  const articles = avg(config.articlesPerUser)
  const polls = avg(config.pollsPerUser)
  const votes = polls * (config.pollVotesMax / 2)
  // Личная галерея: строка File на каждое фото и видео плюс два альбома на человека.
  const gallery = avg(config.photosPerUser) + avg(config.videosPerUser)
  return (
    posts +
    articles +
    polls * (1 + OPTIONS_PER_POLL) +
    votes +
    config.postImagesPerUser +
    gallery +
    (gallery > 0 ? 2 : 0)
  )
}

function estimateRows(plan, config) {
  return Math.round(plan.students * (BASE_ROWS_PER_STUDENT + contentRowsPerUser(config)))
}

/**
 * Оценка объёма ВСЕГО прогона — до первой записи в базу.
 *
 * Считается по тем же формулам, что и строка в логе генератора, но нужна раньше: сид
 * наливает в ту же базу, где живут настоящие пользователи, и «ой, получилось миллиард
 * строк» надо узнать до старта, а не через пять часов.
 */
export function estimateTotalRows(config) {
  if (config.universities <= 0) return 0
  let total = 0
  for (let index = config.from; index <= config.to; index += 1) {
    total += estimateRows(planUniversity(index, universityRandom(index), config), config)
  }
  return total
}

/**
 * Потолки объёма. Мягкий — прогон требует осознанного подтверждения; жёсткий —
 * отказ без вариантов. Оба настраиваются, но умолчания выбраны под боевую базу:
 * 50 млн строк это уже заметный рост, 300 млн — размер, из которого не выбраться
 * ничем, кроме долгой ручной уборки.
 */
export function estimateBytes(rows) {
  return rows * BYTES_PER_ROW
}

/** «12,4 ГБ» / «310 МБ» — то, чем измеряется том, а не число строк. */
export function humanBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} ГБ`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} МБ`
  return `${Math.round(bytes / 1024)} КБ`
}

export function assertRowBudget(config) {
  const estimate = estimateTotalRows(config)
  const nf = (n) => n.toLocaleString('ru-RU')
  const size = humanBytes(estimateBytes(estimate))
  if (estimate > config.maxRowsHard) {
    throw new Error(
      `Оценка прогона — ${nf(estimate)} строк (~${size}), жёсткий потолок ` +
        `${nf(config.maxRowsHard)}. Уменьшите число вузов, студентов или диапазоны контента.`,
    )
  }
  if (estimate > config.maxRowsSoft && !config.confirmBig) {
    throw new Error(
      `Оценка прогона — ${nf(estimate)} строк (~${size}), это больше мягкого потолка ` +
        `${nf(config.maxRowsSoft)}. Если объём осознанный — SEED_CONFIRM_BIG=1.`,
    )
  }
  return estimate
}

export async function seedUniversities(prisma, { config, passwordHash, pool, companies, storage }) {
  const cities = loadCities(KATO_PATH)
  // Реальные вузы Казахстана: индексы 1..130 берут названия оттуда, дальше — синтетика.
  const realUniversities = resolveKzUniversities(KATO_PATH)
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

  // Манифест ДО первой записи: список вузов, которые прогон собирается залить. Маркер
  // ставится только после успешного завершения вуза, и прогон, убитый посреди работы
  // (кончилось место на диске, таймаут job'а, отмена), оставил бы строки, о которых не
  // знает никто. По этому списку уборка находит и такие вузы тоже.
  if (config.tag) {
    await recordRun(prisma, config.tag, {
      planned: indices.map(universityId),
      startedAt: new Date().toISOString(),
    })
  }

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
      config: { ...config, cities, realUniversities },
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
      // Метка прогона: по ней режим cleanup найдёт ровно эти вузы и ничего больше.
      tag: config.tag || null,
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
