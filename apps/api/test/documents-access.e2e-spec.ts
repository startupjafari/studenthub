import request from 'supertest'
import { Client as MinioClient } from 'minio'
import { bearer, createE2eApp, type E2eApp } from './support/e2e-app'

// Фаза 21.E2: документы на настоящей БД и настоящем MinIO — загрузка (буферная и
// многочастная), документ из страниц, грант вузу, факультету и человеку, видимость по
// ролевой матрице §15.2 (админ вуза содержимого не видит ни по какому гранту) и отзыв.
// Проверки комплектов по запросам — в юнит-тестах document-requests; многочастные отказы —
// в uploads-multipart.

const auth = bearer

describe('Документы: загрузка, грант, отзыв (e2e)', () => {
  let e2e: E2eApp

  const minio = new MinioClient({
    endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
    port: Number(process.env.MINIO_PORT ?? 9000),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY ?? '',
    secretKey: process.env.MINIO_SECRET_KEY ?? '',
  })

  // Настоящий PDF по сигнатуре: тип файла сервер определяет по содержимому.
  const pdf = (size: number): Buffer => {
    const head = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
    return Buffer.concat([head, Buffer.alloc(size - head.byteLength, 0x20)])
  }

  beforeAll(async () => {
    e2e = await createE2eApp({ multipart: true, captureQueue: true })
  })

  // TRUNCATE чистит БД, но не хранилище: объекты, загруженные тестом, убираем сами.
  afterEach(async () => {
    const files = await e2e.prisma.file.findMany({
      select: { bucket: true, key: true },
      take: 100,
    })
    for (const { bucket, key } of files) {
      await minio.removeObject(bucket, key).catch(() => undefined)
    }
  })

  afterAll(async () => {
    await e2e.close()
  })

  interface World {
    ownerId: string
    teacherId: string
    adminId: string
    facultyId: string
    tok: Record<
      | 'owner'
      | 'deanOwn'
      | 'deanOther'
      | 'moderator'
      | 'admin'
      | 'teacher'
      | 'peer'
      | 'foreignModerator'
      | 'platform',
      string
    >
  }

  async function world(): Promise<World> {
    e2e.jobs.length = 0
    await e2e.prisma.$executeRawUnsafe(
      'TRUNCATE TABLE document_events, document_access, documents, files, audit_logs, refresh_tokens, groups, faculties, universities, users RESTART IDENTITY CASCADE',
    )
    const uni = await e2e.prisma.university.create({
      data: { name: 'Вуз документов' },
      select: { id: true },
    })
    const foreign = await e2e.prisma.university.create({
      data: { name: 'Чужой вуз' },
      select: { id: true },
    })
    const [own, other] = await Promise.all(
      ['Физфак', 'Химфак'].map((name) =>
        e2e.prisma.faculty.create({
          data: { name, universityId: uni.id },
          select: { id: true },
        }),
      ),
    )
    const user = (email: string, role: string, extra: { facultyId?: string } = {}) =>
      e2e.createUser({
        email,
        firstName: 'Имя',
        lastName: email.split('@')[0]!,
        role: role as never,
        universityId: uni.id,
        ...extra,
      })
    const ownerId = await user('owner@d.io', 'STUDENT', { facultyId: own!.id })
    await user('dean-own@d.io', 'DEAN', { facultyId: own!.id })
    await user('dean-other@d.io', 'DEAN', { facultyId: other!.id })
    await user('mod@d.io', 'UNIVERSITY_MODERATOR')
    const adminId = await user('admin@d.io', 'UNIVERSITY_ADMIN')
    const teacherId = await user('teacher@d.io', 'TEACHER')
    await user('peer@d.io', 'STUDENT', { facultyId: own!.id })
    await e2e.createUser({
      email: 'mod@foreign.io',
      firstName: 'Имя',
      lastName: 'Чужой',
      role: 'UNIVERSITY_MODERATOR',
      universityId: foreign.id,
    })
    await e2e.createUser({
      email: 'platform@d.io',
      firstName: 'Имя',
      lastName: 'Платформа',
      role: 'PLATFORM_ADMIN',
    })
    const tok = {
      owner: await e2e.login('owner@d.io'),
      deanOwn: await e2e.login('dean-own@d.io'),
      deanOther: await e2e.login('dean-other@d.io'),
      moderator: await e2e.login('mod@d.io'),
      admin: await e2e.login('admin@d.io'),
      teacher: await e2e.login('teacher@d.io'),
      peer: await e2e.login('peer@d.io'),
      foreignModerator: await e2e.login('mod@foreign.io'),
      platform: await e2e.login('platform@d.io'),
    }
    return { ownerId, teacherId, adminId, facultyId: own!.id, tok }
  }

  /** Буферная загрузка: `POST /documents/upload`, поле `file`. */
  async function uploadSmall(token: string, name: string): Promise<string> {
    const res = await request(e2e.server)
      .post('/api/v1/documents/upload')
      .set(auth(token))
      .attach('file', pdf(2048), { filename: name, contentType: 'application/pdf' })
      .expect(201)
    expect(res.body.data).toMatchObject({ mime: 'application/pdf', size: 2048 })
    return res.body.data.id as string
  }

  /** Многочастная загрузка одним проходом: start → urls → PUT части в MinIO → complete. */
  async function uploadInParts(token: string, name: string): Promise<string> {
    const body = pdf(64 * 1024)
    const started = await request(e2e.server)
      .post('/api/v1/documents/upload/multipart/start')
      .set(auth(token))
      .send({ mime: 'application/pdf', size: body.byteLength })
      .expect(201)
    const { key, uploadId, partCount } = started.body.data
    expect(partCount).toBe(1)
    const urls = await request(e2e.server)
      .post('/api/v1/documents/upload/multipart/urls')
      .set(auth(token))
      .send({ key, uploadId, from: 1, to: 1 })
      .expect(201)
    const put = await fetch(urls.body.data.parts[0].url, {
      method: 'PUT',
      body: new Uint8Array(body),
    })
    expect(put.status).toBe(200)
    const etag = (put.headers.get('etag') ?? '').replace(/"/g, '')
    const done = await request(e2e.server)
      .post('/api/v1/documents/upload/multipart/complete')
      .set(auth(token))
      .send({ key, uploadId, parts: [{ part: 1, etag }], name })
      .expect(201)
    expect(done.body.data).toMatchObject({ mime: 'application/pdf', size: body.byteLength })
    return done.body.data.id as string
  }

  /** Паспорт владельца из двух страниц: первая — буферной загрузкой, вторая — по частям. */
  async function passport(w: World): Promise<{ id: string; fileIds: string[] }> {
    const first = await uploadSmall(w.tok.owner, 'page-1.pdf')
    const second = await uploadInParts(w.tok.owner, 'page-2.pdf')
    const created = await request(e2e.server)
      .post('/api/v1/documents')
      .set(auth(w.tok.owner))
      .send({ category: 'PERSONAL', type: 'PASSPORT', title: 'Паспорт', number: 'N0012344821' })
      .expect(201)
    expect(created.body.data).toMatchObject({ status: 'DRAFT', numberMasked: '******4821' })
    expect(created.body.data).not.toHaveProperty('number')
    const attached = await request(e2e.server)
      .post(`/api/v1/documents/${created.body.data.id}/files`)
      .set(auth(w.tok.owner))
      .send({ fileIds: [first, second] })
      .expect(201)
    expect(attached.body.data.status).toBe('UPLOADED')
    expect(attached.body.data.files.map((f: { id: string }) => f.id)).toEqual([first, second])
    return { id: created.body.data.id as string, fileIds: [first, second] }
  }

  /** Ссылка на страницу документа глазами `token`: статус и, при 200, сами байты. */
  async function open(token: string, docId: string, fileId: string): Promise<number> {
    const res = await request(e2e.server)
      .get(`/api/v1/documents/${docId}/files/${fileId}/url`)
      .set(auth(token))
    if (res.status === 200) {
      const file = await fetch(res.body.data.url)
      expect(file.status).toBe(200)
      expect(
        Buffer.from(await file.arrayBuffer())
          .subarray(0, 5)
          .toString(),
      ).toBe('%PDF-')
    }
    return res.status
  }

  async function sharedWithMe(token: string): Promise<string[]> {
    const res = await request(e2e.server)
      .get('/api/v1/documents/shared-with-me')
      .set(auth(token))
      .expect(200)
    return res.body.data.map((r: { document: { id: string } }) => r.document.id)
  }

  async function grant(
    w: World,
    docId: string,
    body: { granteeType: string; granteeId?: string },
  ): Promise<string> {
    const res = await request(e2e.server)
      .post(`/api/v1/documents/${docId}/access`)
      .set(auth(w.tok.owner))
      .send({ ...body, reason: 'Проверка документов' })
      .expect(201)
    const row = res.body.data.find(
      (a: { granteeType: string; active: boolean }) => a.granteeType === body.granteeType,
    )
    expect(row).toMatchObject({ active: true, revokedAt: null })
    return row.id as string
  }

  it('без гранта документ видит только владелец; страницы открываются из MinIO', async () => {
    const w = await world()
    const doc = await passport(w)

    expect(await open(w.tok.owner, doc.id, doc.fileIds[0]!)).toBe(200)
    expect(await open(w.tok.owner, doc.id, doc.fileIds[1]!)).toBe(200)
    for (const t of [
      w.tok.deanOwn,
      w.tok.moderator,
      w.tok.admin,
      w.tok.teacher,
      w.tok.peer,
      w.tok.platform,
    ]) {
      expect(await open(t, doc.id, doc.fileIds[0]!)).toBe(404)
      expect(await sharedWithMe(t)).toEqual([])
    }
    // Карточка документа — только владельцу.
    await request(e2e.server)
      .get(`/api/v1/documents/${doc.id}`)
      .set(auth(w.tok.moderator))
      .expect(404)
  })

  it('грант вузу: администрация вуза видит, админ вуза — нет; после отзыва — 404', async () => {
    const w = await world()
    const doc = await passport(w)
    const accessId = await grant(w, doc.id, { granteeType: 'UNIVERSITY' })

    // Модератор вуза и деканы (любого факультета) — администрация вуза.
    for (const t of [w.tok.moderator, w.tok.deanOwn, w.tok.deanOther]) {
      expect(await open(t, doc.id, doc.fileIds[1]!)).toBe(200)
      expect(await sharedWithMe(t)).toEqual([doc.id])
    }
    const shared = await request(e2e.server)
      .get('/api/v1/documents/shared-with-me')
      .set(auth(w.tok.moderator))
      .expect(200)
    // Номер — только маской и здесь.
    expect(shared.body.data[0]).toMatchObject({
      accessId,
      granteeType: 'UNIVERSITY',
      document: { numberMasked: '******4821', fileCount: 2 },
    })
    expect(shared.body.data[0].document).not.toHaveProperty('number')

    // Людям вуза, админу вуза, чужому вузу и платформе грант «Университет» не открывает.
    for (const t of [w.tok.admin, w.tok.teacher, w.tok.peer, w.tok.foreignModerator]) {
      expect(await open(t, doc.id, doc.fileIds[1]!)).toBe(404)
      expect(await sharedWithMe(t)).toEqual([])
    }
    expect(await open(w.tok.platform, doc.id, doc.fileIds[1]!)).toBe(404)

    // Просмотр по гранту — в журнале документа с id гранта; админ вуза видит журнал
    // (метаданные, кто и через что), но не содержимое.
    const events = await request(e2e.server)
      .get(`/api/v1/documents/${doc.id}/events`)
      .set(auth(w.tok.owner))
      .expect(200)
    expect(events.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'GRANT' }),
        expect.objectContaining({ action: 'VIEW' }),
      ]),
    )
    const viewByGrant = await e2e.prisma.documentEvent.findFirstOrThrow({
      where: { documentId: doc.id, action: 'VIEW', actorId: { not: w.ownerId } },
    })
    expect(viewByGrant.metadata).toMatchObject({ accessId, granteeType: 'UNIVERSITY' })
    const journal = await request(e2e.server)
      .get('/api/v1/document-journal')
      .set(auth(w.tok.admin))
      .expect(200)
    const viewed = journal.body.data.find(
      (r: { action: string; granteeType: string | null }) =>
        r.action === 'VIEW' && r.granteeType === 'UNIVERSITY',
    )
    expect(viewed).toMatchObject({
      owner: { id: w.ownerId },
      document: { id: doc.id, category: 'PERSONAL', type: 'PASSPORT' },
    })
    expect(JSON.stringify(journal.body.data)).not.toMatch(/N0012344821|X-Amz-Signature/)

    // Отзыв: доступ гаснет сразу у всех, событие REVOKE в журнале.
    const revoked = await request(e2e.server)
      .delete(`/api/v1/documents/${doc.id}/access/${accessId}`)
      .set(auth(w.tok.owner))
      .expect(200)
    expect(revoked.body.data).toEqual([
      expect.objectContaining({ id: accessId, active: false, revokedAt: expect.any(String) }),
    ])
    for (const t of [w.tok.moderator, w.tok.deanOwn, w.tok.deanOther]) {
      expect(await open(t, doc.id, doc.fileIds[1]!)).toBe(404)
      expect(await sharedWithMe(t)).toEqual([])
    }
    expect(
      await e2e.prisma.documentEvent.count({ where: { documentId: doc.id, action: 'REVOKE' } }),
    ).toBe(1)
    // Чужой человек грант не отзывает и список доступа не видит.
    await request(e2e.server)
      .delete(`/api/v1/documents/${doc.id}/access/${accessId}`)
      .set(auth(w.tok.moderator))
      .expect(404)
  })

  it('грант факультету — только декану этого факультета', async () => {
    const w = await world()
    const doc = await passport(w)
    const accessId = await grant(w, doc.id, { granteeType: 'DEPARTMENT', granteeId: w.facultyId })

    expect(await open(w.tok.deanOwn, doc.id, doc.fileIds[0]!)).toBe(200)
    expect(await sharedWithMe(w.tok.deanOwn)).toEqual([doc.id])
    for (const t of [w.tok.deanOther, w.tok.moderator, w.tok.admin, w.tok.peer]) {
      expect(await open(t, doc.id, doc.fileIds[0]!)).toBe(404)
    }

    await request(e2e.server)
      .delete(`/api/v1/documents/${doc.id}/access/${accessId}`)
      .set(auth(w.tok.owner))
      .expect(200)
    expect(await open(w.tok.deanOwn, doc.id, doc.fileIds[0]!)).toBe(404)
  })

  it('персональный грант: преподавателю открывает и уведомляет, админу вуза — нет', async () => {
    const w = await world()
    const doc = await passport(w)

    const teacherAccess = await grant(w, doc.id, { granteeType: 'USER', granteeId: w.teacherId })
    expect(await open(w.tok.teacher, doc.id, doc.fileIds[0]!)).toBe(200)
    expect(await sharedWithMe(w.tok.teacher)).toEqual([doc.id])
    expect(e2e.jobs).toContainEqual(
      expect.objectContaining({
        queue: 'notifications',
        payload: expect.objectContaining({
          titleKey: 'documents.shared.title',
          recipientIds: [w.teacherId],
        }),
      }),
    )

    // Админ вуза документ не откроет и по персональному гранту — и не зовётся смотреть.
    e2e.jobs.length = 0
    await grant(w, doc.id, { granteeType: 'USER', granteeId: w.adminId })
    expect(await open(w.tok.admin, doc.id, doc.fileIds[0]!)).toBe(404)
    expect(await sharedWithMe(w.tok.admin)).toEqual([])
    expect(e2e.jobs).toEqual([])

    await request(e2e.server)
      .delete(`/api/v1/documents/${doc.id}/access/${teacherAccess}`)
      .set(auth(w.tok.owner))
      .expect(200)
    expect(await open(w.tok.teacher, doc.id, doc.fileIds[0]!)).toBe(404)
    expect(await sharedWithMe(w.tok.teacher)).toEqual([])
  })

  // Спорно, ждёт решения владельца (21.E2): персональный грант (`USER`) проверяется только по
  // id получателя. Выписанный на человека чужого вуза или на платформенного админа, он
  // открывает им скан (проверено: 200 и документ в shared-with-me). Уведомление о гранте
  // при этом сужено до вуза владельца (notifyGrantee), а §3.8 говорит, что платформенный
  // админ обычного доступа к содержимому не имеет — только спец-режим с причиной.
  it.todo('персональный грант человеку чужого вуза не открывает документ')
  it.todo('персональный грант платформенному админу не открывает документ без спец-режима')
})
