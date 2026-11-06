import request from 'supertest'
import { createE2eApp, E2E_PASSWORD as PASSWORD, type E2eApp } from './support/e2e-app'
import { makeBook as makeLibraryBook, makeLibraryUniversity, resetLibrary } from './support/library'

// Фаза 21.C1: удаление аккаунта и библиотека на настоящей БД. С книгой на руках — 409 со
// списком книг; без долгов — брони снимаются, а снимки ФИО обезличиваются в той же
// транзакции, что и сам аккаунт.

const UNI = 'uni-lib-acc'

describe('Удаление аккаунта и библиотека (e2e)', () => {
  let e2e: E2eApp
  let prisma: E2eApp['prisma']
  let server: E2eApp['server']

  beforeAll(async () => {
    e2e = await createE2eApp()
    prisma = e2e.prisma
    server = e2e.server
  })

  afterAll(async () => {
    await e2e.close()
  })

  beforeEach(async () => {
    await resetLibrary(prisma)
    await makeLibraryUniversity(prisma, UNI)
  })

  function makeUser(
    email: string,
    role: 'STUDENT' | 'LIBRARIAN' = 'STUDENT',
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    return e2e.createUser({
      email,
      firstName: 'Айгерим',
      lastName: 'Сейтова',
      role,
      universityId: UNI,
      studentCardNumber: role === 'STUDENT' ? `SC-${email}` : null,
      ...extra,
    })
  }

  const login = (email: string) => e2e.login(email)
  const makeBook = (title: string, copies: string[]) => makeLibraryBook(prisma, UNI, title, copies)

  function loanData(readerId: string, copyId: string, extra: Record<string, unknown> = {}) {
    return {
      universityId: UNI,
      copyId,
      readerId,
      dueAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      readerName: 'Сейтова Айгерим',
      readerGroup: 'ИТ-23-1',
      readerCard: 'SC-777',
      bookTitle: 'Война и мир',
      inventoryNumber: '0012',
      ...extra,
    }
  }

  it('книга на руках: предпроверка показывает её, DELETE /users/me — 409 со списком', async () => {
    const readerId = await makeUser('reader@e2e.io')
    const { copyIds } = await makeBook('Война и мир', ['0012'])
    await prisma.bookCopy.update({ where: { id: copyIds[0] }, data: { status: 'ON_LOAN' } })
    const loan = await prisma.loan.create({ data: loanData(readerId, copyIds[0]!) })
    const token = await login('reader@e2e.io')

    const check = await request(server)
      .get('/api/v1/users/me/deletion-check')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
    expect(check.body.data).toMatchObject({
      canDelete: false,
      blockers: ['libraryDebts'],
      libraryDebts: [
        {
          loanId: loan.id,
          status: 'OPEN',
          bookTitle: 'Война и мир',
          inventoryNumber: '0012',
          overdue: false,
        },
      ],
    })

    // Пароль верный — отказ всё равно, и до проверки пароля (неверный тоже даёт 409).
    const res = await request(server)
      .delete('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'wrong-password' })
      .expect(409)
    expect(res.body.error.code).toBe('LIBRARY_DEBTS_OPEN')
    expect(res.body.error.details).toEqual([
      { field: 'libraryDebts', message: expect.stringContaining('«Война и мир», инв. № 0012') },
    ])

    const user = await prisma.user.findUniqueOrThrow({ where: { id: readerId } })
    expect(user.deletedAt).toBeNull()
    const kept = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } })
    expect(kept.readerName).toBe('Сейтова Айгерим')
  })

  it('утерянная книга с непогашенным долгом — тоже 409; погашенная не мешает', async () => {
    const readerId = await makeUser('lost@e2e.io')
    const { copyIds } = await makeBook('Идиот', ['0100', '0101'])
    await prisma.loan.create({
      data: loanData(readerId, copyIds[0]!, { status: 'LOST', bookTitle: 'Идиот' }),
    })
    const token = await login('lost@e2e.io')
    const res = await request(server)
      .delete('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: PASSWORD })
      .expect(409)
    expect(res.body.error.code).toBe('LIBRARY_DEBTS_OPEN')

    await prisma.loan.updateMany({
      where: { readerId },
      data: { lostSettledAt: new Date() },
    })
    const check = await request(server)
      .get('/api/v1/users/me/deletion-check')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
    expect(check.body.data).toEqual({ canDelete: true, blockers: [], libraryDebts: [] })
  })

  it('без долгов: брони сняты, экземпляр — следующему, снимки ФИО обезличены', async () => {
    const readerId = await makeUser('leaver@e2e.io')
    const nextId = await makeUser('next@e2e.io', 'STUDENT', { firstName: 'Нурлан' })
    const librarianId = await makeUser('lib@e2e.io', 'LIBRARIAN')
    const held = await makeBook('Мастер и Маргарита', ['0200'])
    const queued = await makeBook('Тихий Дон', ['0300'])
    const returned = await makeBook('Война и мир', ['0012'])

    // Готовая бронь удаляемого держит экземпляр; за ним в очереди — второй читатель.
    await prisma.bookCopy.update({
      where: { id: held.copyIds[0] },
      data: { status: 'RESERVED' },
    })
    const ready = await prisma.reservation.create({
      data: {
        universityId: UNI,
        bookId: held.bookId,
        readerId,
        status: 'READY',
        copyId: held.copyIds[0],
        readyAt: new Date(),
        holdUntil: new Date(Date.now() + 3 * 24 * 3600 * 1000),
        createdAt: new Date(Date.now() - 60_000),
      },
    })
    const nextInLine = await prisma.reservation.create({
      data: { universityId: UNI, bookId: held.bookId, readerId: nextId },
    })
    const inQueue = await prisma.reservation.create({
      data: { universityId: UNI, bookId: queued.bookId, readerId },
    })
    // Закрытая выдача и просмотр удостоверения по ней — снимки с ФИО.
    const loan = await prisma.loan.create({
      data: loanData(readerId, returned.copyIds[0]!, {
        status: 'RETURNED',
        returnedAt: new Date(),
      }),
    })
    const view = await prisma.libraryIdAccessLog.create({
      data: {
        universityId: UNI,
        loanId: loan.id,
        librarianId,
        librarianName: 'Библиотекарь Мария',
        readerId,
        readerName: 'Сейтова Айгерим',
      },
    })

    const token = await login('leaver@e2e.io')
    await request(server)
      .delete('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: PASSWORD })
      .expect(200)

    const user = await prisma.user.findUniqueOrThrow({ where: { id: readerId } })
    expect(user.deletedAt).not.toBeNull()

    expect(await prisma.reservation.findUniqueOrThrow({ where: { id: ready.id } })).toMatchObject({
      status: 'CANCELLED',
    })
    expect(await prisma.reservation.findUniqueOrThrow({ where: { id: inQueue.id } })).toMatchObject(
      { status: 'CANCELLED' },
    )
    // Экземпляр не лежит на полке броней под удалённого — отложен следующему.
    expect(
      await prisma.reservation.findUniqueOrThrow({ where: { id: nextInLine.id } }),
    ).toMatchObject({ status: 'READY', copyId: held.copyIds[0] })
    expect(
      await prisma.bookCopy.findUniqueOrThrow({ where: { id: held.copyIds[0] } }),
    ).toMatchObject({ status: 'RESERVED' })

    expect(await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } })).toMatchObject({
      readerName: 'Удалённый пользователь',
      readerGroup: null,
      readerCard: null,
      // Книга и инвентарный номер — история фонда, не ПДн.
      bookTitle: 'Война и мир',
      inventoryNumber: '0012',
    })
    expect(
      await prisma.libraryIdAccessLog.findUniqueOrThrow({ where: { id: view.id } }),
    ).toMatchObject({ readerName: 'Удалённый пользователь', librarianName: 'Библиотекарь Мария' })
  })
})
