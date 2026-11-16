import request from 'supertest'
// Стенд — первым: он грузит AppModule, и граф модулей собирается в том же порядке, что в
// приложении. Сервис, импортированный раньше, ловит циклический импорт недособранным.
import { bearer, createE2eApp, type E2eApp } from './support/e2e-app'
import { makeBook, makeLibraryUniversity, resetLibrary, scanReader } from './support/library'
import { CleanupService } from '../src/modules/cleanup/cleanup.service'

// Фаза 21.E2: жизненный цикл книги на настоящей БД — выдача по скану QR, продление, возврат,
// бронь, «бронь готова», истечение брони по cron и выдача следующему в очереди; должник
// (просрочка и утеря закрывают выдачу и бронь); снятие броней при блокировке и отчислении.
// Выдача без телефона и удаление аккаунта — в library-no-phone и library-account.

const UNI = 'uni-lib-cycle'

describe('Библиотека: выдача, бронь, должник (e2e)', () => {
  let e2e: E2eApp

  beforeAll(async () => {
    e2e = await createE2eApp({ captureQueue: true, bypassCronLocks: true })
  })

  afterAll(async () => {
    await e2e.close()
  })

  beforeEach(async () => {
    e2e.jobs.length = 0
    await resetLibrary(e2e.prisma)
    await makeLibraryUniversity(e2e.prisma, UNI)
  })

  const student = (email: string, firstName: string) =>
    e2e.createUser({
      email,
      firstName,
      lastName: 'Студентов',
      role: 'STUDENT',
      universityId: UNI,
      studentCardNumber: `SC-${email}`,
    })

  const staff = (email: string, role: 'LIBRARIAN' | 'UNIVERSITY_ADMIN') =>
    e2e.createUser({ email, firstName: 'Сотрудник', lastName: 'Вуза', role, universityId: UNI })

  /** Уведомления библиотеки, поставленные в очередь: заголовок → получатели. */
  function notices(): { titleKey: string; recipientIds: string[] }[] {
    return e2e.jobs
      .filter((j) => j.queue === 'notifications')
      .map((j) => ({
        titleKey: j.payload.titleKey as string,
        recipientIds: j.payload.recipientIds as string[],
      }))
  }

  const reservationOf = (readerId: string, bookId: string) =>
    e2e.prisma.reservation.findFirstOrThrow({
      where: { readerId, bookId },
      orderBy: { createdAt: 'desc' },
    })

  it('выдача → продление → бронь в очереди → возврат → «готова» → истечение → выдача следующему', async () => {
    // Два продления по правилам: второе упирается не в предел, а в очередь броней.
    await e2e.prisma.librarySettings.update({
      where: { universityId: UNI },
      data: { maxRenewals: 2 },
    })
    const aId = await student('a@e2e.io', 'Айгерим')
    const bId = await student('b@e2e.io', 'Болат')
    const cId = await student('c@e2e.io', 'Сауле')
    await staff('lib@e2e.io', 'LIBRARIAN')
    const book = await makeBook(e2e.prisma, UNI, 'Абай жолы', ['001'])
    const lib = await e2e.login('lib@e2e.io')
    const a = await e2e.login('a@e2e.io')
    const b = await e2e.login('b@e2e.io')
    const c = await e2e.login('c@e2e.io')

    // Выдача — по пропуску из скана QR; отметка «без телефона» при скане запрещена.
    const scanned = await scanReader(e2e, lib, a)
    expect(scanned).toMatchObject({
      via: 'qr',
      reader: { id: aId },
      eligibility: { canBorrow: true, blockers: [] },
    })
    const marked = await request(e2e.server)
      .post('/api/v1/library/loans')
      .set(bearer(lib))
      .send({ ticket: scanned.ticket, inventoryNumber: '001', withoutPhone: true })
      .expect(409)
    expect(marked.body.error.details[0].field).toBe('noPhoneMark')

    const issued = await request(e2e.server)
      .post('/api/v1/library/loans')
      .set(bearer(lib))
      .send({ ticket: scanned.ticket, inventoryNumber: '001' })
      .expect(201)
    const loan = issued.body.data
    expect(loan).toMatchObject({
      status: 'OPEN',
      renewals: 0,
      overdue: false,
      withoutPhone: false,
      copy: { id: book.copyIds[0], inventoryNumber: '001' },
      reader: { id: aId },
    })
    expect(
      await e2e.prisma.bookCopy.findUniqueOrThrow({ where: { id: book.copyIds[0] } }),
    ).toMatchObject({ status: 'ON_LOAN' })
    expect(notices()).toContainEqual({ titleKey: 'library.loanIssued.title', recipientIds: [aId] })

    const mine = await request(e2e.server)
      .get('/api/v1/library/me/loans')
      .set(bearer(a))
      .expect(200)
    expect(mine.body.data.map((l: { id: string }) => l.id)).toEqual([loan.id])

    // Продление: срок сдвигается вперёд, счётчик растёт.
    const renewed = await request(e2e.server)
      .post(`/api/v1/library/loans/${loan.id}/renew`)
      .set(bearer(lib))
      .send({})
      .expect(201)
    expect(renewed.body.data.renewals).toBe(1)
    expect(renewed.body.data.dueDate > loan.dueDate).toBe(true)
    expect(notices()).toContainEqual({ titleKey: 'library.loanRenewed.title', recipientIds: [aId] })

    // Экземпляр на руках — брони встают в очередь по порядку.
    const bQueued = await request(e2e.server)
      .post(`/api/v1/library/books/${book.bookId}/reservations`)
      .set(bearer(b))
      .expect(201)
    expect(bQueued.body.data).toMatchObject({ status: 'QUEUED', position: 1, copy: null })
    const cQueued = await request(e2e.server)
      .post(`/api/v1/library/books/${book.bookId}/reservations`)
      .set(bearer(c))
      .expect(201)
    expect(cQueued.body.data).toMatchObject({ status: 'QUEUED', position: 2 })
    const dup = await request(e2e.server)
      .post(`/api/v1/library/books/${book.bookId}/reservations`)
      .set(bearer(b))
      .expect(409)
    expect(dup.body.error.details[0].field).toBe('alreadyReserved')

    // Книгу ждут — второе продление закрыто, хотя предел продлений не исчерпан.
    const queueBlocked = await request(e2e.server)
      .post(`/api/v1/library/loans/${loan.id}/renew`)
      .set(bearer(lib))
      .send({})
      .expect(409)
    expect(queueBlocked.body.error.details[0].field).toBe('queue')

    // Возврат: экземпляр откладывается первому в очереди, ему — «бронь готова».
    e2e.jobs.length = 0
    const returned = await request(e2e.server)
      .post('/api/v1/library/returns')
      .set(bearer(lib))
      .send({ inventoryNumber: '001' })
      .expect(201)
    expect(returned.body.data.loan).toMatchObject({ id: loan.id, status: 'RETURNED' })
    expect(returned.body.data.heldFor).toMatchObject({ name: 'Студентов Болат' })
    expect(
      await e2e.prisma.bookCopy.findUniqueOrThrow({ where: { id: book.copyIds[0] } }),
    ).toMatchObject({ status: 'RESERVED' })
    const bReady = await reservationOf(bId, book.bookId)
    expect(bReady).toMatchObject({ status: 'READY', copyId: book.copyIds[0] })
    expect(bReady.holdUntil!.getTime()).toBeGreaterThan(Date.now())
    // Отметка ставится, только когда очередь приняла уведомление.
    expect(bReady.readyNotifiedAt).not.toBeNull()
    expect(notices()).toEqual(
      expect.arrayContaining([
        { titleKey: 'library.loanReturned.title', recipientIds: [aId] },
        { titleKey: 'library.reservationReady.title', recipientIds: [bId] },
      ]),
    )

    const bMine = await request(e2e.server)
      .get('/api/v1/library/me/reservations')
      .set(bearer(b))
      .expect(200)
    expect(bMine.body.data[0]).toMatchObject({
      status: 'READY',
      copy: { inventoryNumber: '001' },
      holdDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    })
    const cMine = await request(e2e.server)
      .get('/api/v1/library/me/reservations')
      .set(bearer(c))
      .expect(200)
    expect(cMine.body.data[0]).toMatchObject({ status: 'QUEUED', position: 1 })

    // Отложенный экземпляр другому читателю не выдать.
    const again = await scanReader(e2e, lib, a)
    const foreign = await request(e2e.server)
      .post('/api/v1/library/loans')
      .set(bearer(lib))
      .send({ ticket: again.ticket, inventoryNumber: '001' })
      .expect(409)
    expect(foreign.body.error.details[0].field).toBe('reserved')

    // Срок брони прошёл, книгу не забрали: cron закрывает бронь и отдаёт экземпляр дальше.
    await e2e.prisma.reservation.update({
      where: { id: bReady.id },
      data: { holdUntil: new Date(Date.now() - 60_000) },
    })
    e2e.jobs.length = 0
    expect(await e2e.app.get(CleanupService).expireLibraryHolds()).toBe(1)
    expect(await reservationOf(bId, book.bookId)).toMatchObject({
      status: 'EXPIRED',
      closedAt: expect.any(Date),
    })
    const cReady = await reservationOf(cId, book.bookId)
    expect(cReady).toMatchObject({ status: 'READY', copyId: book.copyIds[0] })
    expect(notices()).toEqual(
      expect.arrayContaining([
        { titleKey: 'library.reservationExpired.title', recipientIds: [bId] },
        { titleKey: 'library.reservationReady.title', recipientIds: [cId] },
      ]),
    )
    // Повторный прогон ничего не трогает.
    expect(await e2e.app.get(CleanupService).expireLibraryHolds()).toBe(0)

    // Следующий в очереди забирает книгу — бронь закрыта выдачей.
    const cSession = await scanReader(e2e, lib, c)
    const cLoan = await request(e2e.server)
      .post('/api/v1/library/loans')
      .set(bearer(lib))
      .send({ ticket: cSession.ticket, inventoryNumber: '001' })
      .expect(201)
    expect(await reservationOf(cId, book.bookId)).toMatchObject({
      status: 'FULFILLED',
      loanId: cLoan.body.data.id,
    })
    expect(
      await e2e.prisma.bookCopy.findUniqueOrThrow({ where: { id: book.copyIds[0] } }),
    ).toMatchObject({ status: 'ON_LOAN' })
  })

  it('должник с просрочкой: ни выдачи, ни брони, пока книга не вернулась', async () => {
    const aId = await student('a@e2e.io', 'Айгерим')
    await staff('lib@e2e.io', 'LIBRARIAN')
    const first = await makeBook(e2e.prisma, UNI, 'Путь Абая', ['101', '102'])
    const other = await makeBook(e2e.prisma, UNI, 'Кочевники', ['201'])
    const lib = await e2e.login('lib@e2e.io')
    const a = await e2e.login('a@e2e.io')

    const session = await scanReader(e2e, lib, a)
    const issued = await request(e2e.server)
      .post('/api/v1/library/loans')
      .set(bearer(lib))
      .send({ ticket: session.ticket, inventoryNumber: '101' })
      .expect(201)
    // Срок прошёл.
    await e2e.prisma.loan.update({
      where: { id: issued.body.data.id },
      data: { dueAt: new Date(Date.now() - 2 * 24 * 3600 * 1000) },
    })

    const rescanned = await scanReader(e2e, lib, a)
    expect(rescanned.eligibility).toMatchObject({ canBorrow: false, blockers: ['overdue'] })
    const blocked = await request(e2e.server)
      .post('/api/v1/library/loans')
      .set(bearer(lib))
      .send({ ticket: rescanned.ticket, inventoryNumber: '102' })
      .expect(409)
    expect(blocked.body.error.details[0].field).toBe('overdue')
    const noReserve = await request(e2e.server)
      .post(`/api/v1/library/books/${other.bookId}/reservations`)
      .set(bearer(a))
      .expect(409)
    expect(noReserve.body.error.details[0].field).toBe('overdue')

    // Должника видят библиотекарь (фильтр просрочек) и сам читатель (справка).
    const overdue = await request(e2e.server)
      .get('/api/v1/library/loans?filter=overdue')
      .set(bearer(lib))
      .expect(200)
    expect(overdue.body.data).toEqual([
      expect.objectContaining({ id: issued.body.data.id, overdue: true }),
    ])
    const clearance = await request(e2e.server)
      .get('/api/v1/library/me/clearance')
      .set(bearer(a))
      .expect(200)
    expect(clearance.body.data).toMatchObject({ clear: false, loans: [{ overdue: true }] })

    // Вернул — блок снят тем же пропуском.
    await request(e2e.server)
      .post('/api/v1/library/returns')
      .set(bearer(lib))
      .send({ inventoryNumber: '101' })
      .expect(201)
    await request(e2e.server)
      .post('/api/v1/library/loans')
      .set(bearer(lib))
      .send({ ticket: rescanned.ticket, inventoryNumber: '102' })
      .expect(201)
    await request(e2e.server)
      .post(`/api/v1/library/books/${other.bookId}/reservations`)
      .set(bearer(a))
      .expect(201)
    expect(
      await e2e.prisma.loan.findMany({
        where: { readerId: aId, status: 'OPEN' },
        select: { copyId: true },
      }),
    ).toEqual([{ copyId: first.copyIds[1] }])
  })

  it('утерянная книга — долг до погашения: выдача и бронь закрыты, после погашения открыты', async () => {
    const aId = await student('a@e2e.io', 'Айгерим')
    await staff('lib@e2e.io', 'LIBRARIAN')
    const book = await makeBook(e2e.prisma, UNI, 'Ботагоз', ['301', '302'])
    const other = await makeBook(e2e.prisma, UNI, 'Кан', ['401'])
    const lib = await e2e.login('lib@e2e.io')
    const a = await e2e.login('a@e2e.io')

    const session = await scanReader(e2e, lib, a)
    const issued = await request(e2e.server)
      .post('/api/v1/library/loans')
      .set(bearer(lib))
      .send({ ticket: session.ticket, inventoryNumber: '301' })
      .expect(201)
    const lost = await request(e2e.server)
      .post(`/api/v1/library/loans/${issued.body.data.id}/lost`)
      .set(bearer(lib))
      .expect(201)
    expect(lost.body.data).toMatchObject({ status: 'LOST', lostSettledAt: null })
    expect(
      await e2e.prisma.bookCopy.findUniqueOrThrow({ where: { id: book.copyIds[0] } }),
    ).toMatchObject({ status: 'LOST' })

    // Книги на руках нет, но долг остаётся.
    const debtor = await scanReader(e2e, lib, a)
    expect(debtor.eligibility).toMatchObject({ canBorrow: false, blockers: ['lost'] })
    const noLoan = await request(e2e.server)
      .post('/api/v1/library/loans')
      .set(bearer(lib))
      .send({ ticket: debtor.ticket, inventoryNumber: '302' })
      .expect(409)
    expect(noLoan.body.error.details[0].field).toBe('lost')
    const noReserve = await request(e2e.server)
      .post(`/api/v1/library/books/${other.bookId}/reservations`)
      .set(bearer(a))
      .expect(409)
    expect(noReserve.body.error.details[0].field).toBe('lost')
    const debts = await request(e2e.server)
      .get(`/api/v1/library/readers/${aId}/debts`)
      .set(bearer(lib))
      .expect(200)
    expect(debts.body.data).toMatchObject({
      clear: false,
      loans: [{ id: issued.body.data.id, status: 'LOST' }],
    })

    // Погасил (заменил или возместил) — долг закрыт, повторно не гасится.
    const settled = await request(e2e.server)
      .post(`/api/v1/library/loans/${issued.body.data.id}/lost/settle`)
      .set(bearer(lib))
      .expect(201)
    expect(settled.body.data.lostSettledAt).not.toBeNull()
    const twice = await request(e2e.server)
      .post(`/api/v1/library/loans/${issued.body.data.id}/lost/settle`)
      .set(bearer(lib))
      .expect(409)
    expect(twice.body.error.details[0].field).toBe('settled')

    await request(e2e.server)
      .post('/api/v1/library/loans')
      .set(bearer(lib))
      .send({ ticket: debtor.ticket, inventoryNumber: '302' })
      .expect(201)
    await request(e2e.server)
      .post(`/api/v1/library/books/${other.bookId}/reservations`)
      .set(bearer(a))
      .expect(201)
  })

  /**
   * Готовая бронь читателя на одноэкземплярную книгу, за ним в очереди — второй читатель;
   * у первого ещё бронь в очереди на книгу, которая на руках у третьего.
   */
  async function holdsWorld() {
    const aId = await student('a@e2e.io', 'Айгерим')
    const bId = await student('b@e2e.io', 'Болат')
    const cId = await student('c@e2e.io', 'Сауле')
    await staff('lib@e2e.io', 'LIBRARIAN')
    await staff('admin@e2e.io', 'UNIVERSITY_ADMIN')
    const held = await makeBook(e2e.prisma, UNI, 'Мастер и Маргарита', ['501'])
    const lent = await makeBook(e2e.prisma, UNI, 'Тихий Дон', ['601'])
    const lib = await e2e.login('lib@e2e.io')
    const a = await e2e.login('a@e2e.io')
    const b = await e2e.login('b@e2e.io')

    const aSession = await scanReader(e2e, lib, a)
    await request(e2e.server)
      .post('/api/v1/library/loans')
      .set(bearer(lib))
      .send({ ticket: aSession.ticket, inventoryNumber: '601' })
      .expect(201)
    const ready = await request(e2e.server)
      .post(`/api/v1/library/books/${held.bookId}/reservations`)
      .set(bearer(b))
      .expect(201)
    expect(ready.body.data).toMatchObject({ status: 'READY', copy: { inventoryNumber: '501' } })
    await request(e2e.server)
      .post(`/api/v1/library/books/${lent.bookId}/reservations`)
      .set(bearer(b))
      .expect(201)
    const c = await e2e.login('c@e2e.io')
    await request(e2e.server)
      .post(`/api/v1/library/books/${held.bookId}/reservations`)
      .set(bearer(c))
      .expect(201)
    const admin = await e2e.login('admin@e2e.io')
    e2e.jobs.length = 0
    return { aId, bId, cId, held, lent, admin }
  }

  async function expectHoldsReleased(w: Awaited<ReturnType<typeof holdsWorld>>) {
    const bHolds = await e2e.prisma.reservation.findMany({
      where: { readerId: w.bId },
      select: { status: true },
    })
    expect(bHolds).toEqual([{ status: 'CANCELLED' }, { status: 'CANCELLED' }])
    // Отложенный экземпляр не лежит под ушедшего — он у следующего в очереди.
    expect(await reservationOf(w.cId, w.held.bookId)).toMatchObject({
      status: 'READY',
      copyId: w.held.copyIds[0],
    })
    const cancelled = notices().filter((n) => n.titleKey === 'library.reservationCancelled.title')
    expect(cancelled).toEqual([
      { titleKey: 'library.reservationCancelled.title', recipientIds: [w.bId] },
      { titleKey: 'library.reservationCancelled.title', recipientIds: [w.bId] },
    ])
    expect(notices()).toContainEqual({
      titleKey: 'library.reservationReady.title',
      recipientIds: [w.cId],
    })
  }

  it('блокировка снимает брони читателя, отложенный экземпляр уходит следующему', async () => {
    const w = await holdsWorld()
    await request(e2e.server)
      .patch(`/api/v1/users/${w.bId}/block`)
      .set(bearer(w.admin))
      .send({})
      .expect(200)
    await expectHoldsReleased(w)
  })

  it('отчисление снимает брони и закрывает выдачу и бронь', async () => {
    const w = await holdsWorld()
    await request(e2e.server)
      .patch(`/api/v1/users/${w.bId}/academic`)
      .set(bearer(w.admin))
      .send({ academicStatus: 'Отчислен' })
      .expect(200)
    await expectHoldsReleased(w)

    const lib = await e2e.login('lib@e2e.io')
    const b = await e2e.login('b@e2e.io')
    const session = await scanReader(e2e, lib, b)
    expect(session.eligibility).toMatchObject({ canBorrow: false, blockers: ['status'] })
    const noReserve = await request(e2e.server)
      .post(`/api/v1/library/books/${w.lent.bookId}/reservations`)
      .set(bearer(b))
      .expect(409)
    expect(noReserve.body.error.details[0].field).toBe('status')
  })
})
