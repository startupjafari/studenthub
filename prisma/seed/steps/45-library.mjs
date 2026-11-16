// Библиотека вуза (Фаза 20, docs/PROJECT.md §3.11): каталог, экземпляры, полгода истории
// выдач, текущие выдачи с просрочками, брони, журнал просмотров удостоверений и ход
// инвентаризации. Нужна, чтобы каждый экран библиотекаря и студента открывался с данными,
// а не с «пока пусто».
//
// История собирается симуляцией по времени: у каждого экземпляра — цепочка выдач без
// пересечений, последняя может быть открытой. Поэтому статусы сходятся сами: экземпляр
// «выдан» ровно тогда, когда у него есть открытая выдача, «под бронью» — когда на него
// есть готовая бронь. Популярность книг неравная (часть книг берут чаще) — иначе отчёт
// «Популярное» вышел бы плоским.
//
// Повторный запуск по тому же вузу ничего не делает: шаг смотрит, заведены ли уже его книги.

import { createHash } from 'node:crypto'

const DAY = 86_400_000
/** Сколько дней истории выдач. */
const HISTORY_DAYS = 180
/** Сколько читателей вуза участвуют (студенты и старосты с группой). */
const READERS = 60
/** Предел книг на руках — как правило вуза по умолчанию. */
const MAX_OPEN = 5
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
// Учебные статусы ушедших из вуза — оба написания: справочника (как сохраняет API) и кода
// (старые записи). Таким книги не выдаются (isTerminalAcademicStatus в library-loans).
const LEFT_STATUSES = ['Выпускник', 'Отчислен', 'Переведён', 'Переведен', 'GRADUATED', 'EXPELLED', 'TRANSFERRED'] // prettier-ignore
const EXPELLED_STATUSES = ['Отчислен', 'EXPELLED']
const READER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  studentCardNumber: true,
  group: { select: { name: true } },
}

// Каталог: название, авторы, раздел, год, издательство, экземпляров.
const CATALOG = [
  ['Евгений Онегин', 'Пушкин А. С.', 'Художественная литература', 2019, 'Эксмо', 3],
  ['Капитанская дочка', 'Пушкин А. С.', 'Художественная литература', 2020, 'Азбука', 2],
  ['Герой нашего времени', 'Лермонтов М. Ю.', 'Художественная литература', 2018, 'Эксмо', 2],
  ['Мёртвые души', 'Гоголь Н. В.', 'Художественная литература', 2017, 'АСТ', 2],
  ['Преступление и наказание', 'Достоевский Ф. М.', 'Художественная литература', 2021, 'Азбука', 3],
  ['Идиот', 'Достоевский Ф. М.', 'Художественная литература', 2019, 'Эксмо', 2],
  ['Война и мир. Том 1', 'Толстой Л. Н.', 'Художественная литература', 2018, 'АСТ', 3],
  ['Анна Каренина', 'Толстой Л. Н.', 'Художественная литература', 2020, 'Эксмо', 2],
  ['Отцы и дети', 'Тургенев И. С.', 'Художественная литература', 2019, 'Азбука', 2],
  ['Вишнёвый сад', 'Чехов А. П.', 'Художественная литература', 2016, 'АСТ', 2],
  ['Мастер и Маргарита', 'Булгаков М. А.', 'Художественная литература', 2022, 'АСТ', 3],
  ['Собачье сердце', 'Булгаков М. А.', 'Художественная литература', 2021, 'Эксмо', 2],
  ['Тихий Дон. Книга 1', 'Шолохов М. А.', 'Художественная литература', 2017, 'Эксмо', 1],
  ['Абай жолы. 1-кітап', 'Әуезов М. О.', 'Художественная литература', 2017, 'Жазушы', 3],
  ['Абай жолы. 2-кітап', 'Әуезов М. О.', 'Художественная литература', 2017, 'Жазушы', 2],
  ['Қара сөздер', 'Құнанбайұлы А.', 'Художественная литература', 2020, 'Мектеп', 3],
  ['Көшпенділер. Алмас қылыш', 'Есенберлин І.', 'Художественная литература', 2019, 'Жазушы', 2],
  ['Ақ кеме', 'Айтматов Ш.', 'Художественная литература', 2018, 'Атамұра', 2],
  ['Плаха', 'Айтматов Ч.', 'Художественная литература', 2020, 'АСТ', 1],
  ['Мен қазақпын', 'Жұбанов Ж.', 'Художественная литература', 2016, 'Жазушы', 1],
  [
    'История Казахстана с древнейших времён до наших дней',
    'Кан Г. В.',
    'История',
    2021,
    'Алматыкітап',
    4,
  ],
  ['Қазақстан тарихы', 'Қозыбаев М. Қ.', 'История', 2019, 'Атамұра', 3],
  ['Степная империя', 'Кляшторный С. Г., Султанов Т. И.', 'История', 2018, 'Евразия', 1],
  ['Всемирная история', 'Уколова В. И.', 'История', 2017, 'Просвещение', 2],
  [
    'Алгоритмы: построение и анализ',
    'Кормен Т., Лейзерсон Ч., Ривест Р., Штайн К.',
    'Информатика',
    2022,
    'Вильямс',
    4,
  ],
  ['Чистый код', 'Мартин Р.', 'Информатика', 2022, 'Питер', 3],
  ['Совершенный код', 'Макконнелл С.', 'Информатика', 2021, 'БХВ', 2],
  ['Грокаем алгоритмы', 'Бхаргава А.', 'Информатика', 2023, 'Питер', 4],
  ['Изучаем Python', 'Лутц М.', 'Информатика', 2020, 'Вильямс', 3],
  ['Компьютерные сети', 'Таненбаум Э., Уэзеролл Д.', 'Информатика', 2019, 'Питер', 2],
  ['Современные операционные системы', 'Таненбаум Э., Бос Х.', 'Информатика', 2021, 'Питер', 2],
  [
    'Базы данных: проектирование и реализация',
    'Коннолли Т., Бегг К.',
    'Информатика',
    2017,
    'Вильямс',
    2,
  ],
  [
    'Паттерны проектирования',
    'Гамма Э., Хелм Р., Джонсон Р., Влиссидес Дж.',
    'Информатика',
    2020,
    'Питер',
    2,
  ],
  ['Высшая математика для экономистов', 'Кремер Н. Ш.', 'Математика', 2018, 'Юнити', 3],
  [
    'Курс дифференциального и интегрального исчисления',
    'Фихтенгольц Г. М.',
    'Математика',
    2016,
    'Лань',
    2,
  ],
  [
    'Линейная алгебра и аналитическая геометрия',
    'Ильин В. А., Позняк Э. Г.',
    'Математика',
    2019,
    'Физматлит',
    3,
  ],
  [
    'Теория вероятностей и математическая статистика',
    'Гмурман В. Е.',
    'Математика',
    2020,
    'Юрайт',
    3,
  ],
  ['Дискретная математика', 'Новиков Ф. А.', 'Математика', 2021, 'Питер', 2],
  ['Физика. Курс общей физики', 'Савельев И. В.', 'Естественные науки', 2018, 'Лань', 3],
  ['Общая химия', 'Глинка Н. Л.', 'Естественные науки', 2017, 'Юрайт', 2],
  ['Биология', 'Грин Н., Стаут У., Тейлор Д.', 'Естественные науки', 2016, 'Мир', 1],
  ['Экономикс', 'Макконнелл К., Брю С.', 'Экономика', 2019, 'Инфра-М', 3],
  ['Принципы экономикс', 'Мэнкью Н. Г.', 'Экономика', 2020, 'Питер', 2],
  ['Маркетинг менеджмент', 'Котлер Ф., Келлер К.', 'Экономика', 2018, 'Питер', 2],
  ['Финансовый менеджмент', 'Бригхэм Ю., Эрхардт М.', 'Экономика', 2017, 'Питер', 1],
  ['Бухгалтерский учёт', 'Кондраков Н. П.', 'Экономика', 2021, 'Проспект', 2],
  ['Теория государства и права', 'Марченко М. Н.', 'Право', 2019, 'Проспект', 3],
  [
    'Конституционное право Республики Казахстан',
    'Сапаргалиев Г. С.',
    'Право',
    2020,
    'Жеті жарғы',
    2,
  ],
  ['Гражданское право РК. Общая часть', 'Сулейменов М. К.', 'Право', 2018, 'Жеті жарғы', 2],
  ['Общая психология', 'Маклаков А. Г.', 'Психология', 2017, 'Питер', 2],
  ['Психология влияния', 'Чалдини Р.', 'Психология', 2021, 'Питер', 2],
  ['Философия', 'Спиркин А. Г.', 'Философия', 2018, 'Юрайт', 2],
  ['Культурология', 'Солонин Ю. Н.', 'Философия', 2016, 'Юрайт', 1],
  ['English Grammar in Use', 'Murphy R.', 'Языки', 2019, 'Cambridge University Press', 4],
  ['Қазақ тілі: практикалық курс', 'Оралбаева Н.', 'Языки', 2020, 'Мектеп', 3],
  ['Русский язык и культура речи', 'Введенская Л. А.', 'Языки', 2018, 'Феникс', 2],
  ['Основы научных исследований', 'Кожухар В. М.', 'Справочные издания', 2017, 'Дашков и К', 1],
  [
    'Толковый словарь русского языка',
    'Ожегов С. И., Шведова Н. Ю.',
    'Справочные издания',
    2015,
    'Азбуковник',
    1,
  ],
]

/** Код наклейки: детерминирован от вуза и экземпляра, из алфавита readableCode. */
function copyCode(universityId, copyId) {
  const digest = createHash('sha256').update(`${universityId}:${copyId}`).digest()
  let code = ''
  for (let i = 0; i < 8; i += 1) code += CODE_ALPHABET[digest[i] % CODE_ALPHABET.length]
  return code
}

/** ISBN-13 с верной контрольной цифрой: детерминирован от вуза и номера книги. */
function isbn13(universityId, n) {
  const digest = createHash('sha256').update(`${universityId}:isbn:${n}`).digest()
  let body = '9785'
  for (let i = 0; body.length < 12; i += 1) body += String(digest[i] % 10)
  const sum = [...body].reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0)
  return body + String((10 - (sum % 10)) % 10)
}

/** Последний момент местных суток (UTC+offset) того дня, в который попадает `at`. */
function endOfLocalDay(at, offsetHours) {
  const local = new Date(at.getTime() + offsetHours * 3_600_000)
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 23, 59, 59, 999) -
      offsetHours * 3_600_000,
  )
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ universityId: string, random: ReturnType<import('../lib/rng.mjs').makeRandom>, now?: Date }} opts
 */
export async function seedLibrary(prisma, { universityId, random, now = new Date() }) {
  const prefix = `lib-${universityId}`
  const done = await prisma.book.count({ where: { id: { startsWith: `${prefix}-b-` } } })
  if (done > 0) return { skipped: true }

  const university = await prisma.university.findUnique({
    where: { id: universityId },
    select: { id: true, timezone: true },
  })
  if (!university) throw new Error(`seedLibrary: вуз ${universityId} не найден`)
  // Смещение пояса для сроков «до конца дня»: вузы платформы — в Казахстане (UTC+5).
  const offset = 5

  // Ушедшие из вуза (выпускник, отчислен, переведён) читателями не бывают: выдача и бронь
  // им закрыты. Академический отпуск выдачу не закрывает.
  const readers = await prisma.user.findMany({
    where: {
      universityId,
      role: { in: ['STUDENT', 'STAROSTA'] },
      deletedAt: null,
      isBlocked: false,
      groupId: { not: null },
      OR: [{ academicStatus: null }, { academicStatus: { notIn: LEFT_STATUSES } }],
    },
    orderBy: { email: 'asc' },
    take: READERS,
    select: READER_SELECT,
  })
  if (readers.length === 0) return { skipped: true, reason: 'нет студентов с группой' }
  const librarian = await prisma.user.findFirst({
    where: { universityId, role: 'LIBRARIAN', deletedAt: null },
    select: { id: true, firstName: true, lastName: true },
  })
  const librarianName = librarian ? `${librarian.lastName} ${librarian.firstName}` : 'Библиотекарь'

  await prisma.librarySettings.upsert({
    where: { universityId },
    update: { enabled: true },
    create: { universityId, enabled: true },
  })

  // Номера экземпляров — после наибольшего числового номера вуза.
  const existing = await prisma.bookCopy.findMany({
    where: { universityId },
    select: { inventoryNumber: true },
    take: 100_000,
  })
  let nextNumber =
    existing.reduce((max, c) => {
      const n = /^\d+$/.test(c.inventoryNumber) ? Number(c.inventoryNumber) : 0
      return n > max ? n : max
    }, 0) + 1

  const books = []
  const copies = []
  for (const [i, [title, authors, section, year, publisher, count]] of CATALOG.entries()) {
    const bookId = `${prefix}-b-${String(i + 1).padStart(3, '0')}`
    // Популярность: первые книги каждого раздела и учебники берут чаще.
    const weight =
      1 + random.rng() * 4 + (section === 'Информатика' ? 2 : 0) + (i % 7 === 0 ? 3 : 0)
    books.push({
      id: bookId,
      universityId,
      title,
      authors,
      section,
      year,
      publisher,
      // ISBN — у семи книг из десяти: поиск по ISBN и импорт с сопоставлением по нему
      // проверяются на тех, у кого он есть; старые издания каталогизированы без него.
      isbn: i % 10 < 7 ? isbn13(universityId, i + 1) : null,
      createdById: librarian?.id ?? null,
      createdAt: new Date(now.getTime() - (HISTORY_DAYS + 30) * DAY),
      weight,
    })
    for (let c = 0; c < count; c += 1) {
      const copyId = `${prefix}-c-${String(copies.length + 1).padStart(4, '0')}`
      copies.push({
        id: copyId,
        bookId,
        title,
        universityId,
        inventoryNumber: String(nextNumber++),
        code: copyCode(universityId, copyId),
        status: 'AVAILABLE',
        condition: random.chance(0.15) ? 'WORN' : 'GOOD',
        note: null,
        weight,
      })
    }
  }

  // Экземпляры под сценарии ниже (утеря, погашенная утеря, долг отчисленного) из симуляции
  // исключены: симуляция занимает каждый экземпляр выдачами до сегодняшнего дня, и выдача
  // задним числом легла бы поверх чужой — один экземпляр у двух читателей сразу. Берётся
  // последний экземпляр книги, у которой их несколько: на полке остаются остальные.
  const spareCopies = books
    .filter((b) => copies.filter((c) => c.bookId === b.id).length >= 2)
    .map((b) => copies.filter((c) => c.bookId === b.id).at(-1))
  const scripted = {
    lost: spareCopies.find((c) => c.weight > 3) ?? null,
    lostSettled: null,
    debt: null,
  }
  scripted.lostSettled = spareCopies.find((c) => c !== scripted.lost) ?? null
  scripted.debt = spareCopies.find((c) => c !== scripted.lost && c !== scripted.lostSettled) ?? null
  const scriptedCopies = new Set(Object.values(scripted).filter(Boolean))

  // ── Симуляция выдач по экземплярам ────────────────────────────────────────────
  const openByReader = new Map()
  const readerName = (r) => `${r.lastName} ${r.firstName}`
  const loans = []
  const historyStart = now.getTime() - HISTORY_DAYS * DAY
  for (const copy of copies) {
    if (scriptedCopies.has(copy)) continue
    // Чем популярнее книга, тем короче перерывы между выдачами.
    const gap = () => Math.round((random.randInt(3, 30) / Math.min(copy.weight, 6)) * 2) * DAY
    let t = historyStart + random.randInt(0, 20) * DAY
    while (t < now.getTime()) {
      const reader = random.pick(readers)
      const term = random.pick([7, 10, 14, 14, 14, 21])
      const issuedAt = new Date(t + random.randInt(9, 17) * 3_600_000)
      const dueAt = endOfLocalDay(new Date(issuedAt.getTime() + term * DAY), offset)
      // Читатель держит книгу дольше или короче срока; иногда — с просрочкой.
      const heldDays = random.chance(0.12) ? term + random.randInt(1, 12) : random.randInt(2, term)
      const returnedAt = new Date(
        issuedAt.getTime() + heldDays * DAY + random.randInt(1, 6) * 3_600_000,
      )
      if (returnedAt.getTime() < now.getTime()) {
        loans.push({ copy, reader, issuedAt, dueAt, status: 'RETURNED', returnedAt })
        t = returnedAt.getTime() + gap()
        continue
      }
      // Выдача ещё идёт — если у читателя нет предела книг на руках.
      const open = openByReader.get(reader.id) ?? 0
      if (open < MAX_OPEN && random.chance(0.75)) {
        openByReader.set(reader.id, open + 1)
        loans.push({ copy, reader, issuedAt, dueAt, status: 'OPEN', returnedAt: null })
        copy.status = 'ON_LOAN'
      }
      break
    }
  }

  // Утерянные и списанный экземпляры — чтобы в отчёте был выбывший фонд. Две утери: долг
  // читателя (держит справку и выдачу) и погашенный долг (книгу возместили).
  const lostCases = [
    { copy: scripted.lost, issuedDaysAgo: 60, lostDaysAgo: 30, settledDaysAgo: null },
    { copy: scripted.lostSettled, issuedDaysAgo: 150, lostDaysAgo: 120, settledDaysAgo: 100 },
  ]
  for (const lost of lostCases) {
    const issuedAt = new Date(now.getTime() - lost.issuedDaysAgo * DAY)
    const copy = lost.copy
    if (!copy) continue
    loans.push({
      copy,
      reader: random.pick(readers),
      issuedAt,
      dueAt: endOfLocalDay(new Date(issuedAt.getTime() + 14 * DAY), offset),
      status: 'LOST',
      returnedAt: new Date(now.getTime() - lost.lostDaysAgo * DAY),
      lostSettledAt: lost.settledDaysAgo
        ? new Date(now.getTime() - lost.settledDaysAgo * DAY)
        : null,
    })
    copy.status = 'LOST'
  }
  const writtenOff = copies.find((c) => c.status === 'AVAILABLE' && c.condition === 'WORN')
  if (writtenOff) {
    writtenOff.status = 'WRITTEN_OFF'
    writtenOff.note = 'Списан по ветхости: вырваны страницы'
  }

  // Должник, которого отчислили (Фаза 21.C3): книга взята до ухода из вуза и не сдана. Новых
  // выдач ему уже нет — читатели выше ушедших не включают, — а этот долг остаётся на руках.
  const expelled = await prisma.user.findFirst({
    where: {
      universityId,
      role: { in: ['STUDENT', 'STAROSTA'] },
      deletedAt: null,
      academicStatus: { in: EXPELLED_STATUSES },
      leftUniversityAt: { not: null },
    },
    orderBy: { email: 'asc' },
    select: { ...READER_SELECT, leftUniversityAt: true },
  })
  if (expelled) {
    const issuedAt = new Date(expelled.leftUniversityAt.getTime() - 30 * DAY)
    const copy = scripted.debt
    if (copy) {
      loans.push({
        copy,
        reader: expelled,
        issuedAt,
        dueAt: endOfLocalDay(new Date(issuedAt.getTime() + 14 * DAY), offset),
        status: 'OPEN',
        returnedAt: null,
      })
      copy.status = 'ON_LOAN'
    }
  }

  // Две отменённые выдачи: «выдали не тому читателю» — история не правится, а отменяется.
  for (const reason of ['Выдали не тому читателю', 'Ошиблись экземпляром']) {
    const copy = random.pick(copies.filter((c) => c.status === 'AVAILABLE'))
    const issuedAt = new Date(now.getTime() - random.randInt(10, 90) * DAY)
    loans.push({
      copy,
      reader: random.pick(readers),
      issuedAt,
      dueAt: endOfLocalDay(new Date(issuedAt.getTime() + 14 * DAY), offset),
      status: 'CANCELLED',
      returnedAt: null,
      cancelReason: reason,
      cancelledAt: new Date(issuedAt.getTime() + 20 * 60_000),
    })
  }

  const loanRows = loans.map((l, i) => {
    const overdue = l.status === 'OPEN' && l.dueAt.getTime() < now.getTime()
    return {
      id: `${prefix}-l-${String(i + 1).padStart(5, '0')}`,
      universityId,
      copyId: l.copy.id,
      readerId: l.reader.id,
      issuedById: librarian?.id ?? null,
      issuedAt: l.issuedAt,
      dueAt: l.dueAt,
      status: l.status,
      returnedAt: l.returnedAt,
      returnedToId: l.returnedAt ? (librarian?.id ?? null) : null,
      returnCondition: l.status === 'RETURNED' ? l.copy.condition : null,
      cancelledAt: l.cancelledAt ?? null,
      cancelledById: l.cancelledAt ? (librarian?.id ?? null) : null,
      cancelReason: l.cancelReason ?? null,
      lostSettledAt: l.lostSettledAt ?? null,
      lostSettledById: l.lostSettledAt ? (librarian?.id ?? null) : null,
      readerName: readerName(l.reader),
      readerGroup: l.reader.group?.name ?? null,
      readerCard: l.reader.studentCardNumber,
      bookTitle: l.copy.title,
      inventoryNumber: l.copy.inventoryNumber,
      // Напоминания по прошедшим событиям уже «ушли»: иначе первый тик крона разошлёт пачку.
      overdueSentAt: overdue ? new Date(now.getTime() - DAY) : null,
      createdAt: l.issuedAt,
    }
  })
  // Одна открытая выдача оспорена читателем — «это не я».
  const disputed = loanRows.find((l) => l.status === 'OPEN' && l.dueAt.getTime() > now.getTime())
  if (disputed) disputed.disputedAt = new Date(now.getTime() - 2 * DAY)

  // Возврат с повреждением: последний возврат свободного экземпляра — «залит водой». Возврат
  // ставит состояние экземпляра (returnCopy), поэтому экземпляр после него — DAMAGED.
  const copyById = new Map(copies.map((c) => [c.id, c]))
  const damagedLoan = [...loanRows]
    .reverse()
    .find((l) => l.status === 'RETURNED' && copyById.get(l.copyId).status === 'AVAILABLE')
  if (damagedLoan) {
    const copy = copyById.get(damagedLoan.copyId)
    const lastReturn = loanRows
      .filter((l) => l.copyId === copy.id && l.status === 'RETURNED')
      .reduce((a, b) => (a.returnedAt > b.returnedAt ? a : b))
    lastReturn.returnCondition = 'DAMAGED'
    copy.condition = 'DAMAGED'
    copy.note = 'Вернули с залитыми страницами, читать можно'
  }

  // Продлённые выдачи (renewals): срок ещё не вышел, на книгу нет очереди — первые три
  // открытые не оспоренные. Выдачи без скана QR (21.C5): ещё две, с отметкой в журнале
  // удостоверений ниже.
  const openFresh = loanRows.filter(
    (l) => l.status === 'OPEN' && l.dueAt.getTime() > now.getTime() && l !== disputed,
  )
  for (const l of openFresh.slice(0, 3)) {
    // Продление сдвигает срок на срок по умолчанию (defaultLoanDays = 14).
    l.renewals = 1
    l.dueAt = endOfLocalDay(new Date(l.dueAt.getTime() + 14 * DAY), offset)
  }
  const withoutPhone = openFresh.slice(3, 5)
  for (const l of withoutPhone) l.withoutPhone = true

  // Напоминания о скором и сегодняшнем сроке по прошедшим событиям уже «ушли» — как
  // overdueSentAt выше: иначе первый тик крона (remindLibraryLoans) разошлёт пачку.
  for (const l of loanRows) {
    if (l.status !== 'OPEN' || l.issuedAt.getTime() > now.getTime() - DAY) continue
    const left = l.dueAt.getTime() - now.getTime()
    if (left > 0 && left <= 3 * DAY) l.dueSoonSentAt = new Date(now.getTime() - 6 * 3_600_000)
    if (left > 0 && left <= DAY) l.dueTodaySentAt = new Date(now.getTime() - 2 * 3_600_000)
  }

  // ── Брони ─────────────────────────────────────────────────────────────────────
  const reservations = []
  const hasOpen = new Set(
    loanRows.filter((l) => l.status === 'OPEN').map((l) => `${l.readerId}:${l.copyId}`),
  )
  const readerHasBook = (readerId, bookId) =>
    copies.some((c) => c.bookId === bookId && hasOpen.has(`${readerId}:${c.id}`))
  const byBook = new Map()
  for (const c of copies) byBook.set(c.bookId, [...(byBook.get(c.bookId) ?? []), c])
  const popular = [...books].sort((a, b) => b.weight - a.weight)
  let rn = 0
  const reservation = (data) => {
    rn += 1
    reservations.push({ id: `${prefix}-r-${String(rn).padStart(4, '0')}`, universityId, ...data })
  }
  // Очередь: популярные книги, у которых все экземпляры на руках.
  for (const book of popular) {
    const list = byBook.get(book.id) ?? []
    if (!list.every((c) => c.status === 'ON_LOAN')) continue
    const queue = random
      .sample(readers, random.randInt(1, 3))
      .filter((r) => !readerHasBook(r.id, book.id))
    for (const [k, r] of queue.entries()) {
      reservation({
        bookId: book.id,
        readerId: r.id,
        status: 'QUEUED',
        createdAt: new Date(now.getTime() - (5 - k) * DAY),
      })
    }
    if (reservations.length >= 8) break
  }
  // Готовые: свободный экземпляр отложен на полку броней.
  let ready = 0
  for (const book of popular) {
    if (ready >= 5) break
    const copy = (byBook.get(book.id) ?? []).find((c) => c.status === 'AVAILABLE')
    if (!copy) continue
    const r = random.pick(readers)
    if (readerHasBook(r.id, book.id)) continue
    copy.status = 'RESERVED'
    reservation({
      bookId: book.id,
      readerId: r.id,
      status: 'READY',
      copyId: copy.id,
      createdAt: new Date(now.getTime() - 2 * DAY),
      readyAt: new Date(now.getTime() - DAY),
      // Уведомление «бронь готова» принято очередью: без отметки его догонит крон.
      readyNotifiedAt: new Date(now.getTime() - DAY + 60_000),
      holdUntil: endOfLocalDay(new Date(now.getTime() + random.randInt(1, 3) * DAY), offset),
    })
    ready += 1
  }
  // История: забранные, истёкшие и отменённые брони. Забранная — это выдача по брони: она
  // связана с выдачей (loanId), экземпляр — тот, что выдали, закрыта в момент выдачи.
  const fulfilledLoans = loanRows.filter(
    (l) =>
      l.status === 'RETURNED' &&
      l.issuedAt.getTime() < now.getTime() - 15 * DAY &&
      l.issuedAt.getTime() > now.getTime() - 120 * DAY,
  )
  for (const loan of random.sample(fulfilledLoans, 3)) {
    const readyAt = new Date(loan.issuedAt.getTime() - DAY)
    reservation({
      bookId: copyById.get(loan.copyId).bookId,
      readerId: loan.readerId,
      status: 'FULFILLED',
      copyId: loan.copyId,
      loanId: loan.id,
      createdAt: new Date(loan.issuedAt.getTime() - 4 * DAY),
      readyAt,
      readyNotifiedAt: new Date(readyAt.getTime() + 60_000),
      holdUntil: endOfLocalDay(new Date(readyAt.getTime() + 3 * DAY), offset),
      closedAt: loan.issuedAt,
    })
  }
  for (const status of ['EXPIRED', 'EXPIRED', 'CANCELLED']) {
    const book = random.pick(books)
    const createdAt = new Date(now.getTime() - random.randInt(15, 120) * DAY)
    const readyAt = status === 'CANCELLED' ? null : new Date(createdAt.getTime() + 3 * DAY)
    const holdUntil = readyAt ? endOfLocalDay(new Date(readyAt.getTime() + 3 * DAY), offset) : null
    reservation({
      bookId: book.id,
      readerId: random.pick(readers).id,
      status,
      createdAt,
      readyAt,
      readyNotifiedAt: readyAt ? new Date(readyAt.getTime() + 60_000) : null,
      holdUntil,
      // Истёкшая закрывается кроном после конца срока хранения, отменённая — читателем.
      closedAt: holdUntil
        ? new Date(holdUntil.getTime() + random.randInt(1, 6) * 3_600_000)
        : new Date(createdAt.getTime() + random.randInt(1, 3) * DAY),
    })
  }

  // Архивная книга (убрана из каталога): самая непопулярная, у которой ни один экземпляр
  // не выдан, не отложен и не утерян, и нет живых броней — иначе архивировать её API не даст.
  // Её экземпляры списаны: книга ушла из фонда целиком.
  const activeReserved = new Set(
    reservations.filter((r) => r.status === 'QUEUED' || r.status === 'READY').map((r) => r.bookId),
  )
  const archived = [...books]
    .sort((a, b) => a.weight - b.weight)
    .find(
      (b) =>
        !activeReserved.has(b.id) &&
        (byBook.get(b.id) ?? []).every((c) => c.status === 'AVAILABLE'),
    )
  if (archived) {
    archived.archivedAt = new Date(now.getTime() - 20 * DAY)
    archived.description = 'Устаревшее издание: заменено новым, в каталоге не показывается.'
    for (const c of byBook.get(archived.id) ?? []) {
      c.status = 'WRITTEN_OFF'
      c.note = 'Списан вместе с изданием'
    }
  }

  // ── Журнал просмотров удостоверений и инвентаризация ──────────────────────────
  const openLoans = loanRows.filter((l) => l.status === 'OPEN')
  const views = random.sample(openLoans, Math.min(12, openLoans.length)).map((l, i) => ({
    id: `${prefix}-v-${String(i + 1).padStart(3, '0')}`,
    universityId,
    loanId: l.id,
    librarianId: librarian?.id ?? null,
    librarianName,
    readerId: l.readerId,
    readerName: l.readerName,
    ip: `10.0.0.${random.randInt(10, 60)}`,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130',
    createdAt: new Date(now.getTime() - random.randInt(1, 14 * 24) * 3_600_000),
  }))
  // Выдачи без скана — в журнале удостоверений с отметкой, как пишет их выдача (21.C5).
  for (const l of withoutPhone) {
    views.push({
      id: `${prefix}-v-${String(views.length + 1).padStart(3, '0')}`,
      universityId,
      loanId: l.id,
      librarianId: librarian?.id ?? null,
      librarianName,
      readerId: l.readerId,
      readerName: l.readerName,
      withoutPhone: true,
      ip: `10.0.0.${random.randInt(10, 60)}`,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130',
      createdAt: l.issuedAt,
    })
  }

  // Инвентаризация идёт с утра: большая часть полки уже отмечена, часть — нет.
  const startOfToday = new Date(endOfLocalDay(now, offset).getTime() - DAY + 1)
  for (const c of copies) {
    if (c.status === 'AVAILABLE' || c.status === 'RESERVED') {
      c.inventoriedAt = random.chance(0.7)
        ? new Date(
            Math.min(now.getTime(), startOfToday.getTime() + random.randInt(1, 5) * 3_600_000),
          )
        : random.chance(0.5)
          ? new Date(now.getTime() - random.randInt(120, 400) * DAY)
          : null
    } else {
      c.inventoriedAt = random.chance(0.5)
        ? new Date(now.getTime() - random.randInt(120, 400) * DAY)
        : null
    }
  }

  // ── Запись ────────────────────────────────────────────────────────────────────
  await prisma.$transaction(
    async (tx) => {
      await tx.book.createMany({ data: books.map(({ weight, ...b }) => b) })
      await tx.bookCopy.createMany({
        data: copies.map(({ weight, title, ...c }) => c),
      })
      for (let i = 0; i < loanRows.length; i += 500) {
        await tx.loan.createMany({ data: loanRows.slice(i, i + 500) })
      }
      await tx.reservation.createMany({ data: reservations })
      await tx.libraryIdAccessLog.createMany({ data: views })
    },
    { timeout: 120_000 },
  )

  return {
    skipped: false,
    books: books.length,
    copies: copies.length,
    loans: loanRows.length,
    open: openLoans.length,
    overdue: openLoans.filter((l) => l.dueAt.getTime() < now.getTime()).length,
    reservations: reservations.length,
  }
}
