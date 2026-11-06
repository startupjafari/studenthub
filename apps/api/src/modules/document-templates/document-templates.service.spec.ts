import { Role } from '@studenthub/shared-types'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { detectAllowedFileType } from '../files/mime-detector'
import { DOCX_MIME, DocumentTemplatesService } from './document-templates.service'
import { analyzeTemplate } from './docx-template-engine'
import { buildDocx, paragraph, partText } from './__testing__/docx-fixtures'

jest.mock('../files/mime-detector', () => ({ detectAllowedFileType: jest.fn() }))
const detect = detectAllowedFileType as jest.Mock

const UNI = 'uni-1'
const OTHER_UNI = 'uni-2'
const admin: JwtPayload = {
  sub: 'admin-1',
  role: Role.UNIVERSITY_ADMIN,
  universityId: UNI,
  facultyId: null,
  groupId: null,
}
const moderator: JwtPayload = { ...admin, sub: 'mod-1', role: Role.UNIVERSITY_MODERATOR }
const dean: JwtPayload = { ...admin, sub: 'dean-1', role: Role.DEAN, facultyId: 'fac-1' }
const foreignAdmin: JwtPayload = { ...admin, sub: 'admin-2', universityId: OTHER_UNI }

const SOURCE = buildDocx({
  body: paragraph('Справка: {student.fullName}, {student.course} курс, группа {student.group}'),
  footer: '{student.faculty}',
})
const VALIDATION = analyzeTemplate(SOURCE)

function templateRow(patch: Record<string, unknown> = {}) {
  return {
    id: 't-1',
    universityId: UNI,
    title: 'Справка с места учёбы',
    category: 'CERTIFICATE',
    description: null,
    locale: 'ru',
    status: 'PUBLISHED',
    createdAt: new Date('2026-11-01T10:00:00Z'),
    updatedAt: new Date('2026-11-02T10:00:00Z'),
    publishedAt: new Date('2026-11-02T10:00:00Z'),
    currentVersionId: 'v-1',
    publishedVersionId: 'v-1',
    createdBy: { id: 'admin-1', firstName: 'Мария', lastName: 'Примерова' },
    currentVersion: { id: 'v-1', version: 1, valid: true, variables: VALIDATION.variables },
    publishedVersion: { id: 'v-1', version: 1 },
    ...patch,
  }
}

function student(patch: Record<string, unknown> = {}) {
  return {
    id: 'stu-1',
    role: Role.STUDENT,
    universityId: UNI,
    facultyId: 'fac-1',
    firstName: 'Айгерим',
    lastName: 'Нурланова',
    middleName: null,
    birthDate: null,
    studentCardNumber: null,
    course: 3,
    specialty: null,
    studyForm: null,
    educationLevel: null,
    fundingType: null,
    enrollmentYear: null,
    graduationYear: null,
    position: null,
    groupName: 'ИС-23',
    facultyName: 'Факультет ИТ',
    ...patch,
  }
}

function setup() {
  const prisma = {
    documentTemplate: {
      findUnique: jest.fn().mockResolvedValue(templateRow()),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 't-1' }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn().mockResolvedValue({}),
    },
    documentTemplateVersion: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    documentTemplateGeneration: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'gen-1' }),
    },
    $transaction: jest.fn(),
  }
  prisma.$transaction.mockImplementation((arg: unknown): unknown =>
    typeof arg === 'function'
      ? (arg as (tx: unknown) => unknown)(prisma)
      : Promise.all(arg as Promise<unknown>[]),
  )
  const files = {
    upload: jest.fn().mockResolvedValue({ id: 'file-9', size: SOURCE.length, mime: DOCX_MIME }),
    delete: jest.fn().mockResolvedValue(undefined),
    getObjectBuffer: jest.fn().mockResolvedValue(SOURCE),
    getPresignedUrl: jest.fn().mockResolvedValue('https://minio.local/signed'),
  }
  const users = {
    documentTemplatePerson: jest.fn((id: string) =>
      Promise.resolve(
        id === 'stu-1'
          ? student()
          : student({ id, role: Role.UNIVERSITY_ADMIN, firstName: 'Мария', lastName: 'Примерова' }),
      ),
    ),
  }
  const universities = {
    documentRequisites: jest.fn().mockResolvedValue({
      name: 'Пример университета',
      shortName: null,
      city: 'Астана',
      address: null,
      contactPhone: null,
      contactEmail: null,
      website: null,
      timezone: 'Asia/Almaty',
    }),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const config = {
    get: jest.fn((key: string) =>
      key === 'DOCUMENT_TEMPLATE_MAX_BYTES' ? 5 * 1024 * 1024 : 'documents',
    ),
  }
  const service = new DocumentTemplatesService(
    prisma as never,
    files as never,
    users as never,
    universities as never,
    audit as never,
    config as never,
  )
  // Версия для loadVersion: опубликованная, с файлом.
  prisma.documentTemplateVersion.findFirst.mockResolvedValue({
    id: 'v-1',
    version: 1,
    valid: true,
    variables: VALIDATION.variables,
    validation: VALIDATION,
    file: { bucket: 'documents', key: 'k.docx' },
  })
  return { service, prisma, files, users, audit }
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    if (error instanceof AppException) return error.code
    throw error
  }
  throw new Error('ожидалась ошибка')
}

beforeEach(() => detect.mockResolvedValue({ mime: DOCX_MIME, ext: 'docx', category: 'DOCUMENT' }))

describe('DocumentTemplatesService — изоляция вузов', () => {
  it('шаблон другого вуза — WRONG_SCOPE на чтение, загрузку и генерацию', async () => {
    const { service } = setup()
    expect(await codeOf(service.get(foreignAdmin, 't-1'))).toBe('WRONG_SCOPE')
    expect(
      await codeOf(
        service.uploadVersion(foreignAdmin, 't-1', { buffer: SOURCE, filename: 'a.docx' }),
      ),
    ).toBe('WRONG_SCOPE')
    expect(await codeOf(service.generateForStudent(foreignAdmin, 't-1', 'stu-1'))).toBe(
      'WRONG_SCOPE',
    )
  })

  it('список — только по вузу из токена', async () => {
    const { service, prisma } = setup()
    await service.list(foreignAdmin, { page: 1, limit: 20 })
    expect(prisma.documentTemplate.findMany.mock.calls[0][0].where.universityId).toBe(OTHER_UNI)
  })

  it('модератор и декан не видят черновики', async () => {
    const { service, prisma } = setup()
    prisma.documentTemplate.findUnique.mockResolvedValue(templateRow({ status: 'DRAFT' }))
    expect(await codeOf(service.get(moderator, 't-1'))).toBe('NOT_FOUND')
    await service.list(dean, { page: 1, limit: 20, status: 'DRAFT' })
    expect(prisma.documentTemplate.findMany.mock.calls[0][0].where.status).toBe('PUBLISHED')
  })
})

describe('DocumentTemplatesService — загрузка и версии', () => {
  it('сохраняет новую версию в приватный бакет и делает её рабочей', async () => {
    const { service, prisma, files, audit } = setup()
    prisma.documentTemplateVersion.findFirst.mockResolvedValueOnce({ version: 2 })
    prisma.documentTemplateVersion.create.mockResolvedValue({ id: 'v-3', version: 3 })

    await service.uploadVersion(admin, 't-1', {
      buffer: SOURCE,
      filename: 'C:\\docs\\Справка.docx',
    })

    expect(files.upload).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: 'documents', ownerId: 'admin-1', name: 'Справка.docx' }),
    )
    const data = prisma.documentTemplateVersion.create.mock.calls[0][0].data
    expect(data).toMatchObject({ templateId: 't-1', version: 3, fileId: 'file-9', valid: true })
    expect(data.variables).toEqual(VALIDATION.variables)
    expect(data.checksum).toMatch(/^[0-9a-f]{64}$/)
    expect(prisma.documentTemplate.update).toHaveBeenCalledWith({
      where: { id: 't-1' },
      data: { currentVersionId: 'v-3' },
    })
    // Опубликованную версию загрузка не трогает — её меняет только публикация.
    expect(prisma.documentTemplate.update.mock.calls[0][0].data).not.toHaveProperty(
      'publishedVersionId',
    )
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'document_template_version_uploaded' }),
    )
  })

  it('шаблон с неизвестной переменной сохраняется с отчётом, но невалидным', async () => {
    const { service, prisma } = setup()
    prisma.documentTemplateVersion.findFirst.mockResolvedValueOnce(null)
    prisma.documentTemplateVersion.create.mockResolvedValue({ id: 'v-1', version: 1 })
    const bad = buildDocx({ body: paragraph('{student.unknownField}') })

    await service.uploadVersion(admin, 't-1', { buffer: bad, filename: 'a.docx' })

    const data = prisma.documentTemplateVersion.create.mock.calls[0][0].data
    expect(data.valid).toBe(false)
    expect(data.validation.errors[0]).toMatchObject({ code: 'UNKNOWN_VARIABLE' })
  })

  it('.doc, .docm и zip под видом docx не принимаются', async () => {
    const { service, files } = setup()
    expect(
      await codeOf(service.uploadVersion(admin, 't-1', { buffer: SOURCE, filename: 'a.doc' })),
    ).toBe('FILE_TYPE_NOT_ALLOWED')
    detect.mockResolvedValueOnce({
      mime: 'application/vnd.ms-word.document.macroenabled.12',
      ext: 'docm',
      category: 'DOCUMENT',
    })
    expect(
      await codeOf(service.uploadVersion(admin, 't-1', { buffer: SOURCE, filename: 'a.docx' })),
    ).toBe('FILE_TYPE_NOT_ALLOWED')
    detect.mockResolvedValueOnce({ mime: 'application/zip', ext: 'zip', category: 'ARCHIVE' })
    expect(
      await codeOf(service.uploadVersion(admin, 't-1', { buffer: SOURCE, filename: 'a.docx' })),
    ).toBe('FILE_TYPE_NOT_ALLOWED')
    expect(files.upload).not.toHaveBeenCalled()
  })

  it('повреждённый DOCX и макросы — TEMPLATE_FILE_INVALID, файл не сохраняется', async () => {
    const { service, files } = setup()
    const broken = SOURCE.subarray(0, 200)
    const error = await service
      .uploadVersion(admin, 't-1', { buffer: broken, filename: 'a.docx' })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AppException)
    expect((error as AppException).code).toBe('TEMPLATE_FILE_INVALID')
    expect((error as AppException).details).toEqual([{ field: 'file', message: 'CORRUPTED' }])

    const macros = buildDocx({ extraFiles: { 'word/vbaProject.bin': Buffer.from([1]) } })
    const second = await service
      .uploadVersion(admin, 't-1', { buffer: macros, filename: 'a.docx' })
      .catch((e: unknown) => e)
    expect((second as AppException).details).toEqual([{ field: 'file', message: 'MACROS' }])
    expect(files.upload).not.toHaveBeenCalled()
  })

  it('файл больше предела — FILE_TOO_LARGE', async () => {
    const { service } = setup()
    const big = Buffer.alloc(5 * 1024 * 1024 + 1)
    expect(
      await codeOf(service.uploadVersion(admin, 't-1', { buffer: big, filename: 'a.docx' })),
    ).toBe('FILE_TOO_LARGE')
  })

  it('сбой записи версии убирает уже загруженный файл', async () => {
    const { service, prisma, files } = setup()
    prisma.documentTemplateVersion.findFirst.mockResolvedValueOnce(null)
    prisma.documentTemplateVersion.create.mockRejectedValue(new Error('db down'))
    await expect(
      service.uploadVersion(admin, 't-1', { buffer: SOURCE, filename: 'a.docx' }),
    ).rejects.toThrow('db down')
    expect(files.delete).toHaveBeenCalledWith('file-9')
  })

  it('архивный шаблон не меняется', async () => {
    const { service, prisma } = setup()
    prisma.documentTemplate.findUnique.mockResolvedValue(templateRow({ status: 'ARCHIVED' }))
    expect(
      await codeOf(service.uploadVersion(admin, 't-1', { buffer: SOURCE, filename: 'a.docx' })),
    ).toBe('CONFLICT')
  })
})

describe('DocumentTemplatesService — публикация', () => {
  it('публикует только прошедшую проверку версию', async () => {
    const { service, prisma } = setup()
    prisma.documentTemplate.findUnique.mockResolvedValue(
      templateRow({
        status: 'DRAFT',
        publishedVersionId: null,
        currentVersion: { id: 'v-2', version: 2, valid: false, variables: [] },
        currentVersionId: 'v-2',
      }),
    )
    prisma.documentTemplateVersion.findUniqueOrThrow.mockResolvedValue({
      validation: { valid: false, variables: [], errors: [{ code: 'SYNTAX' }], warnings: [] },
    })
    expect(await codeOf(service.publish(admin, 't-1'))).toBe('TEMPLATE_INVALID')
    expect(prisma.documentTemplate.updateMany).not.toHaveBeenCalled()
  })

  it('без файла опубликовать нельзя', async () => {
    const { service, prisma } = setup()
    prisma.documentTemplate.findUnique.mockResolvedValue(
      templateRow({ status: 'DRAFT', currentVersion: null, currentVersionId: null }),
    )
    expect(await codeOf(service.publish(admin, 't-1'))).toBe('TEMPLATE_INVALID')
  })

  it('публикация фиксирует проверенную рабочую версию условным обновлением', async () => {
    const { service, prisma } = setup()
    prisma.documentTemplate.findUnique.mockResolvedValue(templateRow({ status: 'DRAFT' }))
    await service.publish(admin, 't-1')
    expect(prisma.documentTemplate.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 't-1', currentVersionId: 'v-1' },
      data: { status: 'PUBLISHED', publishedVersionId: 'v-1', publishedById: 'admin-1' },
    })
  })
})

describe('DocumentTemplatesService — генерация для студента', () => {
  it('подставляет данные студента из профиля и пишет журнал без ПДн', async () => {
    const { service, prisma, audit } = setup()
    const file = await service.generateForStudent(dean, 't-1', 'stu-1')

    const xml = partText(file.buffer)
    expect(xml).toContain('Справка: Нурланова Айгерим, 3 курс, группа ИС-23')
    expect(partText(file.buffer, 'word/footer1.xml')).toContain('Факультет ИТ')
    expect(file.filename).toBe('Справка с места учёбы.docx')
    expect(prisma.documentTemplateGeneration.create).toHaveBeenCalledWith({
      data: {
        templateId: 't-1',
        versionId: 'v-1',
        universityId: UNI,
        studentId: 'stu-1',
        actorId: 'dean-1',
      },
      select: { id: true },
    })
    const logged = JSON.stringify(audit.record.mock.calls)
    expect(logged).not.toContain('Нурланова')
    expect(logged).toContain('document_template_generated')
  })

  it('студент другого вуза — WRONG_SCOPE', async () => {
    const { service, users, prisma } = setup()
    users.documentTemplatePerson.mockResolvedValueOnce(student({ universityId: OTHER_UNI }))
    expect(await codeOf(service.generateForStudent(admin, 't-1', 'stu-1'))).toBe('WRONG_SCOPE')
    expect(prisma.documentTemplateGeneration.create).not.toHaveBeenCalled()
  })

  it('декан — только студенты своего факультета', async () => {
    const { service, users } = setup()
    users.documentTemplatePerson.mockResolvedValueOnce(student({ facultyId: 'fac-2' }))
    expect(await codeOf(service.generateForStudent(dean, 't-1', 'stu-1'))).toBe('WRONG_SCOPE')
  })

  it('не студент — NOT_FOUND', async () => {
    const { service, users } = setup()
    users.documentTemplatePerson.mockResolvedValueOnce(student({ role: Role.TEACHER }))
    expect(await codeOf(service.generateForStudent(admin, 't-1', 'stu-1'))).toBe('NOT_FOUND')
  })

  it('пустое обязательное поле — TEMPLATE_DATA_MISSING со списком полей', async () => {
    const { service, users, files } = setup()
    users.documentTemplatePerson.mockResolvedValueOnce(student({ facultyName: null }))
    const error = await service.generateForStudent(admin, 't-1', 'stu-1').catch((e: unknown) => e)
    expect((error as AppException).code).toBe('TEMPLATE_DATA_MISSING')
    expect((error as AppException).details?.map((d) => d.field)).toEqual(['student.faculty'])
    expect(files.getObjectBuffer).not.toHaveBeenCalled()
  })

  it('черновик не формируется', async () => {
    const { service, prisma } = setup()
    prisma.documentTemplate.findUnique.mockResolvedValue(
      templateRow({ status: 'DRAFT', publishedVersionId: null }),
    )
    expect(await codeOf(service.generateForStudent(admin, 't-1', 'stu-1'))).toBe('BAD_REQUEST')
  })

  it('проверочная генерация берёт демо-данные, а не профиль, и не пишет журнал выдач', async () => {
    const { service, prisma, users } = setup()
    const file = await service.testGenerate(admin, 't-1', undefined)
    expect(partText(file.buffer)).toContain('Нурланова Айгерим Ержановна')
    expect(users.documentTemplatePerson).not.toHaveBeenCalled()
    expect(prisma.documentTemplateGeneration.create).not.toHaveBeenCalled()
  })
})

describe('DocumentTemplatesService — удаление', () => {
  it('без выданных документов — удаляет шаблон и файлы версий', async () => {
    const { service, prisma, files } = setup()
    prisma.documentTemplateVersion.findMany.mockResolvedValue([
      { fileId: 'f-1' },
      { fileId: 'f-2' },
    ])
    expect(await service.remove(admin, 't-1')).toEqual({ archived: false })
    expect(prisma.documentTemplate.delete).toHaveBeenCalledWith({ where: { id: 't-1' } })
    expect(files.delete.mock.calls.map((c) => c[0])).toEqual(['f-1', 'f-2'])
  })

  it('по шаблону выдавали документы — архив, версии и файлы остаются', async () => {
    const { service, prisma, files } = setup()
    prisma.documentTemplateGeneration.count.mockResolvedValue(4)
    expect(await service.remove(admin, 't-1')).toEqual({ archived: true })
    expect(prisma.documentTemplate.delete).not.toHaveBeenCalled()
    expect(prisma.documentTemplate.update.mock.calls[0][0].data).toMatchObject({
      status: 'ARCHIVED',
      publishedVersionId: null,
    })
    expect(files.delete).not.toHaveBeenCalled()
  })
})
