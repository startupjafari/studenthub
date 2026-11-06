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

  const readers = await prisma.user.findMany({
    where: {
      universityId,
      role: { in: ['STUDENT', 'STAROSTA'] },
      deletedAt: null,
      isBlocked: false,
      groupId: { not: null },
    },
    orderBy: { email: 'asc' },
    take: READERS,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      studentCardNumber: true,
      group: { select: { name: true } },
    },
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
        weight,
      })
    }
  }

  // ── Симуляция выдач по экземплярам ────────────────────────────────────────────
  const openByReader = new Map()
  const readerName = (r) => `${r.lastName} ${r.firstName}`
  const loans = []
  const historyStart = now.getTime() - HISTORY_DAYS * DAY
  for (const copy of copies) {
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

  // Утерянный и списанный экземпляры — чтобы в отчёте был выбывший фонд.
  const lostCopy = copies.find((c) => c.status === 'AVAILABLE' && c.weight > 3)
  if (lostCopy) {
    const reader = random.pick(readers)
    const issuedAt = new Date(now.getTime() - 60 * DAY)
    loans.push({
      copy: lostCopy,
      reader,
      issuedAt,
      dueAt: endOfLocalDay(new Date(issuedAt.getTime() + 14 * DAY), offset),
      status: 'LOST',
      returnedAt: new Date(now.getTime() - 30 * DAY),
    })
    lostCopy.status = 'LOST'
  }
  const writtenOff = copies.find((c) => c.status === 'AVAILABLE' && c.condition === 'WORN')
  if (writtenOff) writtenOff.status = 'WRITTEN_OFF'

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
      holdUntil: endOfLocalDay(new Date(now.getTime() + random.randInt(1, 3) * DAY), offset),
    })
    ready += 1
  }
  // История: забранные, истёкшие и отменённые брони.
  for (const status of ['FULFILLED', 'FULFILLED', 'FULFILLED', 'EXPIRED', 'EXPIRED', 'CANCELLED']) {
    const book = random.pick(books)
    const createdAt = new Date(now.getTime() - random.randInt(15, 120) * DAY)
    reservation({
      bookId: book.id,
      readerId: random.pick(readers).id,
      status,
      createdAt,
      readyAt: status === 'CANCELLED' ? null : new Date(createdAt.getTime() + 3 * DAY),
      holdUntil: status === 'CANCELLED' ? null : new Date(createdAt.getTime() + 6 * DAY),
      closedAt: new Date(createdAt.getTime() + random.randInt(4, 7) * DAY),
    })
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
