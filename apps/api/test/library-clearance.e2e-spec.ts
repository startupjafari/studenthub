import request from 'supertest'
import { createE2eApp, type E2eApp } from './support/e2e-app'
import { makeLibraryUniversity, resetLibrary } from './support/library'

// Фаза 21.C4: справка «задолженностей нет» с кодом проверки на настоящей БД — выдача PDF,
// публичная проверка по коду, журнал справок вуза (фильтр по JSON-реквизитам) и отзыв.

const UNI = 'uni-lib-clr'

describe('Справка библиотеки с кодом проверки (e2e)', () => {
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
    await prisma.university.create({ data: { id: 'uni-other', name: 'Чужой вуз' } })
  })

  function makeUser(
    email: string,
    role: 'STUDENT' | 'LIBRARIAN',
    universityId = UNI,
  ): Promise<string> {
    return e2e.createUser({
      email,
      firstName: 'Айгерим',
      lastName: 'Сейтова',
      role,
      universityId,
    })
  }

  const login = (email: string) => e2e.login(email)

  it('без долгов: PDF с кодом, проверка по коду, журнал вуза и отзыв', async () => {
    const readerId = await makeUser('reader@e2e.io', 'STUDENT')
    await makeUser('lib@e2e.io', 'LIBRARIAN')
    await makeUser('lib-other@e2e.io', 'LIBRARIAN', 'uni-other')
    const student = await login('reader@e2e.io')

    const res = await request(server)
      .post('/api/v1/library/me/clearance/certificate?locale=ru')
      .set('Authorization', `Bearer ${student}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = []
        r.on('data', (c: Buffer) => chunks.push(c))
        r.on('end', () => cb(null, Buffer.concat(chunks)))
      })
      .expect(201)
    expect(res.headers['content-type']).toContain('application/pdf')
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-')
    const code = res.headers['x-verification-code'] as string
    expect(code).toMatch(/^[A-Z0-9]{8}$/)

    const verified = await request(server).get(`/api/v1/verify/${code}`).expect(200)
    expect(verified.body.data).toMatchObject({
      kind: 'library-clearance',
      status: 'VALID',
      issuer: 'Библиотечный вуз',
      subject: 'Сейтова А.',
    })

    const mine = await request(server)
      .get('/api/v1/library/me/clearance/certificates')
      .set('Authorization', `Bearer ${student}`)
      .expect(200)
    expect(mine.body.data).toEqual([
      expect.objectContaining({
        code,
        revokedAt: null,
        reader: { id: readerId, name: expect.any(String) },
      }),
    ])

    // Библиотекарь чужого вуза справку не видит и не отзывает.
    const other = await login('lib-other@e2e.io')
    const otherList = await request(server)
      .get('/api/v1/library/clearances')
      .set('Authorization', `Bearer ${other}`)
      .expect(200)
    expect(otherList.body.data).toEqual([])
    await request(server)
      .post(`/api/v1/library/clearances/${code}/revoke`)
      .set('Authorization', `Bearer ${other}`)
      .send({ reason: 'Книга не вернулась' })
      .expect(404)

    const librarian = await login('lib@e2e.io')
    const list = await request(server)
      .get('/api/v1/library/clearances?status=active')
      .set('Authorization', `Bearer ${librarian}`)
      .expect(200)
    expect(list.body.data).toEqual([expect.objectContaining({ code })])
    expect(list.body.meta.total).toBe(1)

    const revoked = await request(server)
      .post(`/api/v1/library/clearances/${code.toLowerCase()}/revoke`)
      .set('Authorization', `Bearer ${librarian}`)
      .send({ reason: 'Книга не вернулась' })
      .expect(201)
    expect(revoked.body.data.revokedAt).not.toBeNull()
    const after = await request(server).get(`/api/v1/verify/${code}`).expect(200)
    expect(after.body.data.status).toBe('REVOKED')
    await request(server)
      .post(`/api/v1/library/clearances/${code}/revoke`)
      .set('Authorization', `Bearer ${librarian}`)
      .send({ reason: 'Ещё раз' })
      .expect(409)
  })

  it('книга на руках — справки нет, в журнал ничего не пишется', async () => {
    const readerId = await makeUser('debtor@e2e.io', 'STUDENT')
    const book = await prisma.book.create({ data: { universityId: UNI, title: 'Идиот' } })
    const copy = await prisma.bookCopy.create({
      data: {
        bookId: book.id,
        universityId: UNI,
        inventoryNumber: '0001',
        code: 'CLR00001',
        status: 'ON_LOAN',
      },
    })
    await prisma.loan.create({
      data: {
        universityId: UNI,
        copyId: copy.id,
        readerId,
        dueAt: new Date(Date.now() + 86_400_000),
        readerName: 'Сейтова Айгерим',
        bookTitle: 'Идиот',
        inventoryNumber: '0001',
      },
    })
    const token = await login('debtor@e2e.io')
    const res = await request(server)
      .post('/api/v1/library/me/clearance/certificate')
      .set('Authorization', `Bearer ${token}`)
      .expect(409)
    expect(res.body.error.details[0].field).toBe('debts')
    expect(await prisma.documentExport.count()).toBe(0)
  })
})
