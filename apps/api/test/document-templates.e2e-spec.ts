import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { ThrottlerGuard, ThrottlerStorage } from '@nestjs/throttler'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import PizZip from 'pizzip'
import request from 'supertest'
import { FILE_UPLOAD } from '@studenthub/shared-config'
import { AppModule } from '../src/app.module'
import { throttlerStorageStub } from './throttler-storage.stub'
import { PrismaService } from '../src/common/prisma/prisma.service'
import { PasswordService } from '../src/common/security/password.service'
import { FileService } from '../src/modules/files/file.service'
import {
  buildDocx,
  paragraph,
  table,
} from '../src/modules/document-templates/__testing__/docx-fixtures'

const PASSWORD = 'Passw0rd!'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/**
 * Шаблоны документов целиком: настоящий разбор DOCX, MinIO, Postgres и HTTP (§3.8).
 * Данные выдуманные. Проверяется то, чего не видно в unit-тестах с моками: тип файла
 * по сигнатуре, хранение исходника, отдача готового DOCX и изоляция вузов на живых запросах.
 */
describe('Шаблоны документов (e2e)', () => {
  let app: NestFastifyApplication
  let prisma: PrismaService
  let passwords: PasswordService
  let server: ReturnType<NestFastifyApplication['getHttpServer']>

  let adminA: string
  let adminB: string
  let deanOther: string
  let studentId: string
  let studentNoFaculty: string
  let templateId: string

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

  const TEMPLATE = buildDocx({
    body:
      paragraph(
        'Справка: {student.fullName} — студент {student.course} курса, группа {student.group}.',
      ) + table([['Факультет', '{student.faculty}']]),
    header: '{university.name}',
    footer: 'Дата: {document.date}',
  })

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideProvider(ThrottlerStorage)
      .useValue(throttlerStorageStub)
      .compile()

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    app.setGlobalPrefix('api/v1')
    await app.register(cookie)
    await app.register(multipart, {
      limits: { fileSize: FILE_UPLOAD.DIRECT_UPLOAD_THRESHOLD_BYTES, files: 1 },
    })
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    prisma = app.get(PrismaService)
    passwords = app.get(PasswordService)
    server = app.getHttpServer()
    await seed()
  })

  afterAll(async () => {
    // Исходники версий — настоящие объекты в MinIO: убираем вместе с записями.
    const files = await prisma.file.findMany({
      where: { documentTemplateVersion: { isNot: null } },
      select: { id: true },
      take: 100,
    })
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE document_template_generations, document_template_versions, document_templates CASCADE',
    )
    const fileService = app.get(FileService)
    for (const f of files) await fileService.delete(f.id).catch(() => undefined)
    await app.close()
  })

  async function seed(): Promise<void> {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE document_template_generations, document_template_versions, document_templates, groups, faculties, refresh_tokens, users, universities RESTART IDENTITY CASCADE',
    )
    await prisma.university.create({ data: { id: 'uni-a', name: 'Университет Альфа' } })
    await prisma.university.create({ data: { id: 'uni-b', name: 'Университет Бета' } })
    const faculty = await prisma.faculty.create({
      data: { name: 'Факультет информационных технологий', universityId: 'uni-a' },
    })
    const otherFaculty = await prisma.faculty.create({
      data: { name: 'Экономический факультет', universityId: 'uni-a' },
    })
    const group = await prisma.group.create({ data: { name: 'ИС-23', facultyId: faculty.id } })

    studentId = await makeUser('student@alpha.kz', 'STUDENT', 'uni-a', {
      firstName: 'Айгерим',
      lastName: 'Нурланова',
      facultyId: faculty.id,
      groupId: group.id,
      course: 3,
    })
    // Студент без факультета и группы — для политики пустых значений.
    studentNoFaculty = await makeUser('lost@alpha.kz', 'STUDENT', 'uni-a', { course: 1 })

    await makeUser('admin@alpha.kz', 'UNIVERSITY_ADMIN', 'uni-a')
    await makeUser('admin@beta.kz', 'UNIVERSITY_ADMIN', 'uni-b')
    await makeUser('dean@alpha.kz', 'DEAN', 'uni-a', { facultyId: otherFaculty.id })
    adminA = await login('admin@alpha.kz')
    adminB = await login('admin@beta.kz')
    deanOther = await login('dean@alpha.kz')
  }

  async function makeUser(
    email: string,
    role: string,
    universityId: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await passwords.hash(PASSWORD),
        firstName: 'Сотрудник',
        lastName: 'Примерный',
        role: role as never,
        universityId,
        ...extra,
      },
    })
    return user.id
  }

  async function login(email: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ identifier: email, password: PASSWORD })
      .expect(201)
    return res.body.data.accessToken as string
  }

  function documentXml(body: Buffer, part = 'word/document.xml'): string {
    return new PizZip(body).file(part)?.asText() ?? ''
  }

  it('создаёт шаблон, принимает DOCX и находит переменные', async () => {
    const created = await request(server)
      .post('/api/v1/document-templates')
      .set(auth(adminA))
      .send({ title: 'Справка с места учёбы', category: 'CERTIFICATE' })
      .expect(201)
    templateId = created.body.data.id
    expect(created.body.data.status).toBe('DRAFT')

    const uploaded = await request(server)
      .post(`/api/v1/document-templates/${templateId}/versions`)
      .set(auth(adminA))
      .attach('file', TEMPLATE, { filename: 'Справка.docx', contentType: DOCX_MIME })
      .expect(201)
    const version = uploaded.body.data.versions[0]
    expect(version.version).toBe(1)
    expect(version.validation.valid).toBe(true)
    expect(version.validation.variables).toEqual(
      expect.arrayContaining([
        'student.fullName',
        'student.course',
        'student.group',
        'university.name',
      ]),
    )
  })

  it('не принимает zip под видом docx и повреждённый файл', async () => {
    const zip = new PizZip()
    zip.file('readme.txt', 'просто архив')
    const res = await request(server)
      .post(`/api/v1/document-templates/${templateId}/versions`)
      .set(auth(adminA))
      .attach('file', zip.generate({ type: 'nodebuffer' }) as Buffer, 'fake.docx')
    expect(res.status).toBe(415)
    expect(res.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED')

    const macros = buildDocx({ extraFiles: { 'word/vbaProject.bin': Buffer.from([1, 2, 3]) } })
    const bad = await request(server)
      .post(`/api/v1/document-templates/${templateId}/versions`)
      .set(auth(adminA))
      .attach('file', macros, 'macros.docx')
    // file-type определяет его как обычный docx — отказывает разбор архива.
    expect([415, 422]).toContain(bad.status)
  })

  it('отдаёт проверочный DOCX с демонстрационными данными', async () => {
    const res = await request(server)
      .post(`/api/v1/document-templates/${templateId}/test`)
      .set(auth(adminA))
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = []
        r.on('data', (c: Buffer) => chunks.push(c))
        r.on('end', () => done(null, Buffer.concat(chunks)))
      })
      .expect(200)
    expect(res.headers['content-type']).toContain(DOCX_MIME)
    expect(documentXml(res.body as Buffer)).toContain('Нурланова Айгерим Ержановна')
  })

  it('чужой вуз не видит шаблон и не формирует по нему', async () => {
    const read = await request(server)
      .get(`/api/v1/document-templates/${templateId}`)
      .set(auth(adminB))
    expect(read.status).toBe(403)
    expect(read.body.error.code).toBe('WRONG_SCOPE')
    const list = await request(server)
      .get('/api/v1/document-templates')
      .set(auth(adminB))
      .expect(200)
    expect(list.body.data).toEqual([])
  })

  it('публикует и формирует документ студенту с данными профиля', async () => {
    await request(server)
      .post(`/api/v1/document-templates/${templateId}/publish`)
      .set(auth(adminA))
      .expect(201)

    const res = await request(server)
      .post(`/api/v1/document-templates/${templateId}/generate`)
      .set(auth(adminA))
      .send({ studentId })
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = []
        r.on('data', (c: Buffer) => chunks.push(c))
        r.on('end', () => done(null, Buffer.concat(chunks)))
      })
      .expect(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['content-disposition']).toContain(
      encodeURIComponent('Справка с места учёбы'),
    )
    const xml = documentXml(res.body as Buffer)
    expect(xml).toContain('Справка: Нурланова Айгерим — студент 3 курса, группа ИС-23.')
    expect(xml).toContain('Факультет информационных технологий')
    expect(documentXml(res.body as Buffer, 'word/header1.xml')).toContain('Университет Альфа')

    const generations = await prisma.documentTemplateGeneration.count({ where: { templateId } })
    expect(generations).toBe(1)
  })

  it('пустое обязательное поле — 422 со списком полей', async () => {
    const res = await request(server)
      .post(`/api/v1/document-templates/${templateId}/generate`)
      .set(auth(adminA))
      .send({ studentId: studentNoFaculty })
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('TEMPLATE_DATA_MISSING')
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toEqual(
      expect.arrayContaining(['student.group', 'student.faculty']),
    )
  })

  it('чужой студент: админ другого вуза и декан другого факультета получают отказ', async () => {
    const foreignAdmin = await request(server)
      .post(`/api/v1/document-templates/${templateId}/generate`)
      .set(auth(adminB))
      .send({ studentId })
    expect(foreignAdmin.status).toBe(403)

    const dean = await request(server)
      .post(`/api/v1/document-templates/${templateId}/generate`)
      .set(auth(deanOther))
      .send({ studentId })
    expect(dean.status).toBe(403)
    expect(dean.body.error.code).toBe('WRONG_SCOPE')
  })

  it('новая версия не подменяет опубликованную, а удаление выданного шаблона — архив', async () => {
    const v2 = buildDocx({ body: paragraph('Новая редакция: {student.fullName}') })
    const uploaded = await request(server)
      .post(`/api/v1/document-templates/${templateId}/versions`)
      .set(auth(adminA))
      .attach('file', v2, 'Справка-2.docx')
      .expect(201)
    expect(uploaded.body.data.currentVersion.version).toBe(2)
    expect(uploaded.body.data.publishedVersion.version).toBe(1)
    expect(uploaded.body.data.hasUnpublishedChanges).toBe(true)

    const removed = await request(server)
      .delete(`/api/v1/document-templates/${templateId}`)
      .set(auth(adminA))
      .expect(200)
    expect(removed.body.data).toEqual({ archived: true })
    const versions = await prisma.documentTemplateVersion.count({ where: { templateId } })
    expect(versions).toBe(2)
  })
})
