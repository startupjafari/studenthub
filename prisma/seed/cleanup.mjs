// Режим `cleanup`: удалить ровно то, что налил прогон с указанной меткой.
//
// ЗАЧЕМ ОН ВООБЩЕ ЕСТЬ. Сид наливает в ту же базу, где живут настоящие пользователи, и
// «сбросить базу» здесь недопустимо ни в каком виде. Значит уборка бывает только
// прицельной: прогон помечает каждый созданный вуз меткой (lib/marker.mjs), а этот
// режим по метке находит вузы и сносит их вместе со всем, что к ним привязано.
//
// ПОЧЕМУ НЕ `DELETE FROM universities`. Академическая структура связана Restrict'ами
// (docs/PROJECT.md §5): факультет нельзя удалить, пока есть группы, группу — пока есть
// расписание, вуз — пока есть пользователи. Это защита от случайного сноса деканата
// вместе с пятью тысячами студентов, и обходить её нельзя — только соблюдать порядок.
//
// ПОЧЕМУ ПОЛЬЗОВАТЕЛИ ПЕРВЫМИ. Почти весь контент (посты, файлы, альбомы, статьи,
// опросы, сообщения, оценки, посещаемость) привязан к пользователю каскадом и уходит
// вместе с ним одним запросом. Остаётся академический каркас — его и разбираем ниже
// снизу вверх.

import { clearRun, loadPlannedUniversities, loadUniversitiesByTag } from './lib/marker.mjs'
import { DEMO_UNIVERSITY_ID } from './lib/ids.mjs'

// Пользователей за один DELETE. Каскад уносит десятки строк на человека, и снос
// миллиона разом означал бы одну транзакцию на несколько гигабайт WAL.
const USER_BATCH = 2000

// Вуз, созданный генератором, имеет id вида u042. Всё остальное — заведено руками или
// основным сидом, и метка на такой строке означала бы ошибку, а не разрешение удалять.
const GENERATED_ID = /^u\d{3,}$/

function assertDeletable(uniId) {
  if (uniId === DEMO_UNIVERSITY_ID) {
    throw new Error(`cleanup: демо-вуз ${uniId} не удаляется — на него ссылаются e2e и доки`)
  }
  if (!GENERATED_ID.test(uniId)) {
    throw new Error(
      `cleanup: id "${uniId}" не похож на вуз генератора (ожидается u001, u042 и т.п.). ` +
        'Уборка остановлена: удалять вуз, заведённый не сидом, она не должна.',
    )
  }
}

async function deleteUsers(prisma, universityId, log) {
  let removed = 0
  for (;;) {
    const users = await prisma.user.findMany({
      where: { universityId },
      select: { id: true },
      take: USER_BATCH,
    })
    if (users.length === 0) break
    const { count } = await prisma.user.deleteMany({
      where: { id: { in: users.map((u) => u.id) } },
    })
    removed += count
    log(`    пользователи: ${removed}`)
    // Защита от бесконечного цикла: если удалить не удалось, но строки есть — падаем
    // с понятной ошибкой, а не крутимся молча.
    if (count === 0) throw new Error(`cleanup: пользователи вуза ${universityId} не удаляются`)
  }
  return removed
}

/**
 * Разбирает один вуз. Порядок продиктован Restrict-связями и проверяется самой базой:
 * нарушение выдаст ошибку внешнего ключа с именем ограничения, а не тихую порчу данных.
 */
async function deleteUniversity(prisma, universityId, log) {
  const counts = {}
  const run = async (name, promise) => {
    const { count } = await promise
    if (count > 0) counts[name] = (counts[name] ?? 0) + count
  }

  counts.user = await deleteUsers(prisma, universityId, log)

  const faculties = await prisma.faculty.findMany({ where: { universityId }, select: { id: true } })
  const facultyIds = faculties.map((f) => f.id)
  const groups = await prisma.group.findMany({
    where: { facultyId: { in: facultyIds } },
    select: { id: true },
  })
  const groupIds = groups.map((g) => g.id)

  // Заявки раньше услуг: поданный документ держит требование услуги связью Restrict
  // (ApplicationDocument.requirement), а сама заявка держит вуз. Дочерние строки заявки
  // и услуги уходят каскадом, перечислять их не нужно.
  await run('application', prisma.application.deleteMany({ where: { universityId } }))
  await run('applicationService', prisma.applicationService.deleteMany({ where: { universityId } }))

  // Пары держат группу (Restrict), курсы — предмет. Переносы расписания привязаны к паре
  // каскадом и уходят вместе с ней.
  await run('pair', prisma.pair.deleteMany({ where: { groupId: { in: groupIds } } }))
  await run('schedule', prisma.schedule.deleteMany({ where: { groupId: { in: groupIds } } }))
  await run('course', prisma.course.deleteMany({ where: { groupId: { in: groupIds } } }))

  await run('group', prisma.group.deleteMany({ where: { id: { in: groupIds } } }))
  await run('subject', prisma.subject.deleteMany({ where: { universityId } }))
  await run('term', prisma.term.deleteMany({ where: { universityId } }))
  await run('room', prisma.room.deleteMany({ where: { universityId } }))
  await run('specialty', prisma.specialty.deleteMany({ where: { universityId } }))
  await run('faculty', prisma.faculty.deleteMany({ where: { id: { in: facultyIds } } }))

  // Всё остальное, что ссылается на вуз напрямую. Авторы этих строк уже удалены вместе
  // с пользователями, но сами строки могли пережить их через SetNull.
  await run('documentRequest', prisma.documentRequest.deleteMany({ where: { universityId } }))
  await run('documentType', prisma.documentType.deleteMany({ where: { universityId } }))
  await run('document', prisma.document.deleteMany({ where: { universityId } }))
  await run('complaint', prisma.complaint.deleteMany({ where: { universityId } }))
  await run('event', prisma.event.deleteMany({ where: { universityId } }))
  await run('post', prisma.post.deleteMany({ where: { universityId } }))
  await run('chat', prisma.chat.deleteMany({ where: { universityId } }))
  await run('companyUniversityAccess', prisma.companyUniversityAccess.deleteMany({ where: { universityId } })) // prettier-ignore
  await run('vacancyUniversityReview', prisma.vacancyUniversityReview.deleteMany({ where: { universityId } })) // prettier-ignore
  await run('universityDemoRequest', prisma.universityDemoRequest.deleteMany({ where: { universityId } })) // prettier-ignore
  await run('universityOnboarding', prisma.universityOnboarding.deleteMany({ where: { universityId } })) // prettier-ignore
  await run('invite', prisma.invite.deleteMany({ where: { universityId } }))

  await run('university', prisma.university.deleteMany({ where: { id: universityId } }))
  return counts
}

/**
 * Уборка прогона по метке.
 *
 * @param config конфиг сида; нужны config.tag и config.databaseUrl
 */
export async function runCleanup(prisma, config) {
  const tag = config.tag
  // Два источника, и второй важнее первого. Маркеры — это вузы, доведённые до конца;
  // манифест — те, что прогон СОБИРАЛСЯ залить. Прогон, убитый посреди работы, попадает
  // только во второй список, и без него его строки не удалить ничем, кроме ручного SQL.
  const done = await loadUniversitiesByTag(prisma, tag)
  const planned = await loadPlannedUniversities(prisma, tag)
  const candidates = [...new Set([...done, ...planned])].sort()
  if (candidates.length === 0) {
    console.log(`cleanup: прогонов с меткой "${tag}" не найдено — удалять нечего`)
    return { universities: 0, counts: {} }
  }
  for (const uniId of candidates) assertDeletable(uniId)

  // Запланированный вуз мог не начаться вовсе: в базе его нет, и трогать нечего.
  const existing = await prisma.university.findMany({
    where: { id: { in: candidates } },
    select: { id: true },
  })
  const uniIds = existing.map((u) => u.id)
  const missing = candidates.length - uniIds.length
  if (missing > 0) {
    console.log(`cleanup: ${missing} вуз(ов) из манифеста в базе нет — пропущены`)
  }
  if (uniIds.length === 0) {
    // Строк нет, но манифест и маркеры остались — убираем их, чтобы метка не висела.
    await clearRun(prisma, tag, candidates)
    console.log(`cleanup: данных с меткой "${tag}" в базе нет, манифест снят`)
    return { universities: 0, counts: {} }
  }

  console.log(`cleanup: метка "${tag}", вузов к удалению ${uniIds.length}`)
  const total = {}
  for (const [i, uniId] of uniIds.entries()) {
    process.stdout.write(`\r  ${i + 1}/${uniIds.length} ${uniId}                    `)
    const counts = await deleteUniversity(prisma, uniId, (line) => {
      process.stdout.write(`\r  ${i + 1}/${uniIds.length} ${uniId} ${line}`)
    })
    for (const [model, count] of Object.entries(counts)) {
      total[model] = (total[model] ?? 0) + count
    }
  }
  process.stdout.write('\n')

  // Манифест и маркеры — последними: пока они на месте, прерванную уборку можно
  // просто перезапустить, и она продолжит с того же списка вузов.
  await clearRun(prisma, tag, candidates)

  const rows = Object.values(total).reduce((sum, n) => sum + n, 0)
  console.log(`cleanup: удалено ${rows.toLocaleString('ru-RU')} строк из ${uniIds.length} вузов`)
  for (const [model, count] of Object.entries(total).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${model}: ${count.toLocaleString('ru-RU')}`)
  }
  return { universities: uniIds.length, counts: total }
}
