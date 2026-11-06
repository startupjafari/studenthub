import { Role } from '@studenthub/shared-types'
import { MaterialsService, materialsOrderBy } from './materials.service'
import { MaterialListQuerySchema } from '@studenthub/shared-schemas'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { FileService } from '../files/file.service'
import type { ConfigService } from '@nestjs/config'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

function setup() {
  const prisma = {
    material: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'm-new' }),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    group: { findUnique: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
    file: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0) },
    // По умолчанию преподаватель ведёт дисциплину в группе.
    course: { findFirst: jest.fn().mockResolvedValue({ id: 'c1' }) },
    pair: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const files = {
    upload: jest.fn(),
    findOrThrow: jest.fn(),
    getPresignedUrl: jest.fn(),
    startMultipart: jest
      .fn()
      .mockResolvedValue({ key: 'u1/k.mp4', uploadId: 'up-1', partSize: 10, partCount: 6 }),
    presignParts: jest.fn().mockResolvedValue({ parts: [], expiresAt: 'e' }),
    completeMultipart: jest.fn(),
    abortMultipart: jest.fn().mockResolvedValue(undefined),
  }
  const config = { get: jest.fn().mockReturnValue('materials') }
  const media = { describeOne: jest.fn().mockResolvedValue({ status: 'READY', sources: [] }) }
  const service = new MaterialsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    files as unknown as FileService,
    config as unknown as ConfigService<EnvVars, true>,
    media as never,
  )
  return { service, prisma, files, media, audit }
}

const user = (role: Role, scope: Partial<JwtPayload> = {}): JwtPayload => ({
  sub: scope.sub ?? 'u1',
  role,
  universityId: scope.universityId ?? null,
  facultyId: scope.facultyId ?? null,
  groupId: scope.groupId ?? null,
})

describe('MaterialsService.list — scope', () => {
  // where теперь { AND: [scope, ...фильтры] } — scope это AND[0]. Клиентские фильтры лишь
  // СУЖАЮТ scope и не могут его перезаписать (регрессия cross-tenant утечки).
  async function scopeOf(v: JwtPayload, query: Record<string, unknown> = {}) {
    const { service, prisma } = setup()
    await service.list(v, query as never)
    return prisma.material.findMany.mock.calls[0][0].where.AND
  }
  it('студент — только своя группа', async () => {
    const and = await scopeOf(user(Role.STUDENT, { groupId: 'g1' }))
    expect(and[0]).toEqual({ groupId: 'g1' })
  })
  it('декан — свой факультет', async () => {
    const and = await scopeOf(user(Role.DEAN, { facultyId: 'f1' }))
    expect(and[0]).toEqual({ group: { is: { facultyId: 'f1' } } })
  })
  it('преподаватель — свои материалы и группы, где ведёт занятия, а не весь вуз', async () => {
    const and = await scopeOf(user(Role.TEACHER, { sub: 't1', universityId: 'uni1' }))
    expect(and[0]).toEqual({
      OR: [
        { teacherId: 't1' },
        {
          group: {
            is: {
              faculty: { is: { universityId: 'uni1' } },
              OR: [
                { courses: { some: { teacherId: 't1' } } },
                { pairs: { some: { teacherId: 't1', schedule: { is: { isActive: true } } } } },
              ],
            },
          },
        },
      ],
    })
  })
  // Регрессия: ?groupId=чужая-группа НЕ перезаписывает scope студента — в AND остаются оба
  // условия (своя группа И запрошенная), пересечение = пусто, чужие материалы не видны.
  it('студент не может подменить группу через ?groupId=', async () => {
    const and = await scopeOf(user(Role.STUDENT, { groupId: 'g1' }), { groupId: 'g2' })
    expect(and).toContainEqual({ groupId: 'g1' })
    expect(and).toContainEqual({ groupId: 'g2' })
  })
})

describe('MaterialsService.list — фильтры и страницы', () => {
  const teacher = user(Role.TEACHER, { sub: 't1', universityId: 'uni1' })

  it('mine — только свои материалы, а не поток всего вуза', async () => {
    const { service, prisma } = setup()
    await service.list(teacher, { mine: true })
    const and = prisma.material.findMany.mock.calls[0][0].where.AND
    // Scope преподавателя остаётся первым условием (его форма — в тесте выше), «мои» сужают его.
    expect(and[0].OR).toContainEqual({ teacherId: 't1' })
    expect(and).toContainEqual({ teacherId: 't1' })
  })

  it('subject — материалы дисциплины выбираются на сервере', async () => {
    const { service, prisma } = setup()
    await service.list(user(Role.STUDENT, { groupId: 'g1' }), { subject: 'Математика' })
    expect(prisma.material.findMany.mock.calls[0][0].where.AND).toContainEqual({
      subject: 'Математика',
    })
  })

  it('свежие сверху, следующая страница — по cursor, limit не выше потолка', async () => {
    const { service, prisma } = setup()
    await service.list(teacher, { cursor: 'm-9', limit: 50 })
    expect(prisma.material.findMany.mock.calls[0][0]).toMatchObject({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
      cursor: { id: 'm-9' },
      skip: 1,
    })
  })

  it('без limit — потолок 200', async () => {
    const { service, prisma } = setup()
    await service.list(teacher, {})
    expect(prisma.material.findMany.mock.calls[0][0].take).toBe(200)
  })

  it('page — страница таблицы: skip/take, сортировка на сервере и meta.total', async () => {
    const { service, prisma } = setup()
    prisma.material.count.mockResolvedValue(45)
    const res = await service.list(teacher, {
      mine: true,
      page: 3,
      limit: 20,
      sort: 'teacher',
      order: 'asc',
    })
    const args = prisma.material.findMany.mock.calls[0][0]
    expect(args.skip).toBe(40)
    expect(args.take).toBe(20)
    expect(args.orderBy).toEqual([
      { teacher: { lastName: 'asc' } },
      { teacher: { firstName: 'asc' } },
      { id: 'asc' },
    ])
    // Тот же scope и фильтр «мои» — и у страницы, и у счётчика строк.
    expect(prisma.material.count.mock.calls[0][0].where).toBe(args.where)
    expect(res).toMatchObject({ meta: { total: 45 } })
  })

  it('page вместе с cursor — 400: режимы выдачи не смешиваются', async () => {
    const { service, prisma } = setup()
    await expect(service.list(teacher, { page: 1, cursor: 'm-1' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
    expect(prisma.material.findMany).not.toHaveBeenCalled()
  })

  it('порядок колонок: дисциплина без названия — в конце, без sort — свежие сверху', () => {
    expect(materialsOrderBy('subject', 'desc')).toEqual([
      { subject: { sort: 'desc', nulls: 'last' } },
      { id: 'desc' },
    ])
    expect(materialsOrderBy('files', undefined)).toEqual([
      { media: { _count: 'asc' } },
      { id: 'asc' },
    ])
    expect(materialsOrderBy(undefined, undefined)).toEqual([{ createdAt: 'desc' }, { id: 'desc' }])
  })

  it('схема: страница таблицы — не больше 100 строк, прежний список — до 200', () => {
    expect(MaterialListQuerySchema.safeParse({ page: '1', limit: '100' }).success).toBe(true)
    expect(MaterialListQuerySchema.safeParse({ page: '1', limit: '101' }).success).toBe(false)
    expect(MaterialListQuerySchema.safeParse({ limit: '200' }).success).toBe(true)
    expect(MaterialListQuerySchema.safeParse({ sort: 'url' }).success).toBe(false)
  })
})

describe('MaterialsService.subjects — счётчики по дисциплинам', () => {
  it('считает по всей выборке scope, а не по странице списка', async () => {
    const { service, prisma } = setup()
    const groupBy = jest.fn().mockResolvedValue([
      { subject: 'Математика', _count: { _all: 240 } },
      { subject: null, _count: { _all: 3 } },
    ])
    ;(prisma.material as unknown as { groupBy: jest.Mock }).groupBy = groupBy
    const res = await service.subjects(user(Role.STUDENT, { groupId: 'g1' }), {})
    expect(res).toEqual([
      { subject: 'Математика', count: 240 },
      { subject: null, count: 3 },
    ])
    expect(groupBy.mock.calls[0][0].where.AND[0]).toEqual({ groupId: 'g1' })
  })
})

describe('MaterialsService.create — scope группы', () => {
  it('преподаватель чужого вуза → WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.group.findUnique.mockResolvedValue({
      facultyId: 'f1',
      faculty: { universityId: 'uniX' },
    })
    const err = await service
      .create(user(Role.TEACHER, { universityId: 'uni1' }), { groupId: 'g1', title: 'T' }, ctx)
      .catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')
  })
  it('преподаватель своего вуза → создаёт', async () => {
    const { service, prisma } = setup()
    prisma.group.findUnique.mockResolvedValue({
      facultyId: 'f1',
      faculty: { universityId: 'uni1' },
    })
    const res = await service.create(
      user(Role.TEACHER, { universityId: 'uni1' }),
      { groupId: 'g1', title: 'T' },
      ctx,
    )
    expect(res.id).toBe('m-new')
  })

  // C-F27: раньше преподаватель выкладывал материал любой группе своего вуза.
  describe('преподаватель — только группам, где ведёт занятия', () => {
    const teacher = user(Role.TEACHER, { sub: 't1', universityId: 'uni1' })
    function prime() {
      const env = setup()
      env.prisma.group.findUnique.mockResolvedValue({
        facultyId: 'f1',
        faculty: { universityId: 'uni1' },
      })
      return env
    }

    it('ни дисциплины, ни пары в группе → WRONG_SCOPE, материал не создаётся', async () => {
      const { service, prisma } = prime()
      prisma.course.findFirst.mockResolvedValue(null)
      const err = await service.create(teacher, { groupId: 'g1', title: 'T' }, ctx).catch((e) => e)
      expect(err.code).toBe('WRONG_SCOPE')
      expect(prisma.course.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { teacherId: 't1', groupId: 'g1' } }),
      )
      expect(prisma.pair.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { teacherId: 't1', groupId: 'g1', schedule: { is: { isActive: true } } },
        }),
      )
      expect(prisma.material.create).not.toHaveBeenCalled()
    })

    it('пара действующего расписания без дисциплины — тоже основание', async () => {
      const { service, prisma } = prime()
      prisma.course.findFirst.mockResolvedValue(null)
      prisma.pair.findFirst.mockResolvedValue({ id: 'p1' })
      const res = await service.create(teacher, { groupId: 'g1', title: 'T' }, ctx)
      expect(res.id).toBe('m-new')
    })

    it('декан факультета — без проверки преподавания', async () => {
      const { service, prisma } = prime()
      prisma.course.findFirst.mockResolvedValue(null)
      const dean = user(Role.DEAN, { facultyId: 'f1', universityId: 'uni1' })
      const res = await service.create(dean, { groupId: 'g1', title: 'T' }, ctx)
      expect(res.id).toBe('m-new')
      expect(prisma.course.findFirst).not.toHaveBeenCalled()
    })
  })
})

describe('MaterialsService — многочастная загрузка файла (21.B1)', () => {
  const author = user(Role.TEACHER, { sub: 'u1', universityId: 'uni1' })
  const parts = [{ part: 1, etag: 'e1' }]

  it('start открывает загрузку в бакет материалов от имени автора', async () => {
    const { service, prisma, files } = setup()
    prisma.material.findUnique.mockResolvedValue({ id: 'm1', teacherId: 'u1', groupId: 'g1' })
    await service.startFileMultipart(author, 'm1', 'video/mp4', 60_000_000)
    expect(files.startMultipart).toHaveBeenCalledWith({
      bucket: 'materials',
      mime: 'video/mp4',
      size: 60_000_000,
      ownerId: 'u1',
    })
  })

  it('чужой материал преподавателю — FORBIDDEN, загрузка не открывается', async () => {
    const { service, prisma, files } = setup()
    prisma.material.findUnique.mockResolvedValue({ id: 'm1', teacherId: 'other', groupId: 'g1' })
    prisma.group.findUnique.mockResolvedValue({
      facultyId: 'f1',
      faculty: { universityId: 'uni1' },
    })
    await expect(
      service.startFileMultipart(author, 'm1', 'video/mp4', 60_000_000),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(files.startMultipart).not.toHaveBeenCalled()
  })

  it('при предельном числе файлов start → CONFLICT(files)', async () => {
    const { service, prisma, files } = setup()
    prisma.material.findUnique.mockResolvedValue({ id: 'm1', teacherId: 'u1', groupId: 'g1' })
    prisma.file.count.mockResolvedValue(30)
    await expect(
      service.startFileMultipart(author, 'm1', 'video/mp4', 60_000_000),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(files.startMultipart).not.toHaveBeenCalled()
  })

  it('подписи частей чужого материала не выдаются', async () => {
    const { service, prisma, files } = setup()
    prisma.material.findUnique.mockResolvedValue({ id: 'm1', teacherId: 'other', groupId: 'g1' })
    prisma.group.findUnique.mockResolvedValue({
      facultyId: 'f1',
      faculty: { universityId: 'uni1' },
    })
    await expect(
      service.fileMultipartUrls(author, 'm1', {
        key: 'u1/k.mp4',
        uploadId: 'up-1',
        from: 1,
        to: 6,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(files.presignParts).not.toHaveBeenCalled()
  })

  it('complete собирает, привязывает к материалу и пишет аудит', async () => {
    const { service, prisma, files, audit } = setup()
    prisma.material.findUnique.mockResolvedValue({ id: 'm1', teacherId: 'u1', groupId: 'g1' })
    files.completeMultipart.mockResolvedValue({
      id: 'f9',
      name: 'lecture.mp4',
      mime: 'video/mp4',
      size: 60_000_000,
      createdAt: new Date(0),
    })
    const res = await service.completeFileMultipart(
      author,
      'm1',
      { key: 'u1/k.mp4', uploadId: 'up-1', parts, name: 'lecture.mp4' },
      ctx,
    )
    expect(files.completeMultipart).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: 'materials',
        key: 'u1/k.mp4',
        uploadId: 'up-1',
        parts,
        ownerId: 'u1',
        materialId: 'm1',
        name: 'lecture.mp4',
      }),
    )
    // Архивы в материалах не принимаются — как у буферной загрузки и confirm.
    expect(files.completeMultipart.mock.calls[0][0].allowArchives).toBeUndefined()
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'material_file_added', entityId: 'm1' }),
    )
    expect(res).toMatchObject({ id: 'f9', name: 'lecture.mp4' })
  })

  it('abort уходит в бакет материалов с владельцем-вызывающим', async () => {
    const { service, files } = setup()
    await service.abortFileMultipart(author, { key: 'u1/k.mp4', uploadId: 'up-1' })
    expect(files.abortMultipart).toHaveBeenCalledWith({
      bucket: 'materials',
      ownerId: 'u1',
      key: 'u1/k.mp4',
      uploadId: 'up-1',
    })
  })
})

describe('MaterialsService — управление своими', () => {
  it('чужой материал преподавателем → FORBIDDEN при удалении', async () => {
    const { service, prisma } = setup()
    prisma.material.findUnique.mockResolvedValue({ id: 'm1', teacherId: 'other', groupId: 'g1' })
    prisma.group.findUnique.mockResolvedValue({
      facultyId: 'f1',
      faculty: { universityId: 'uni1' },
    })
    const err = await service
      .remove(user(Role.TEACHER, { sub: 'u1', universityId: 'uni1' }), 'm1', ctx)
      .catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
  })
  it('свой материал → удаляется', async () => {
    const { service, prisma } = setup()
    prisma.material.findUnique.mockResolvedValue({ id: 'm1', teacherId: 'u1', groupId: 'g1' })
    prisma.material.delete.mockResolvedValue({})
    await service.remove(user(Role.TEACHER, { sub: 'u1' }), 'm1', ctx)
    expect(prisma.material.delete).toHaveBeenCalledWith({ where: { id: 'm1' } })
  })

  it('у материала уже предельное число файлов → CONFLICT(files), файл не загружается', async () => {
    const { service, prisma, files } = setup()
    prisma.material.findUnique.mockResolvedValue({ id: 'm1', teacherId: 'u1', groupId: 'g1' })
    prisma.file.count.mockResolvedValue(30)
    const err = await service
      .addFile(user(Role.TEACHER, { sub: 'u1' }), 'm1', Buffer.from('x'), 'lecture.pdf', ctx)
      .catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(err.details).toEqual([expect.objectContaining({ field: 'files' })])
    expect(files.upload).not.toHaveBeenCalled()
  })

  it('addFile передаёт исходное имя файла', async () => {
    const { service, prisma, files } = setup()
    prisma.material.findUnique.mockResolvedValue({ id: 'm1', teacherId: 'u1', groupId: 'g1' })
    files.upload.mockResolvedValue({ id: 'f1', name: 'lecture.pdf', mime: 'application/pdf' })
    const res = await service.addFile(
      user(Role.TEACHER, { sub: 'u1' }),
      'm1',
      Buffer.from('x'),
      'lecture.pdf',
      ctx,
    )
    expect(files.upload).toHaveBeenCalledWith(expect.objectContaining({ name: 'lecture.pdf' }))
    expect(res).toMatchObject({ id: 'f1', name: 'lecture.pdf' })
  })

  it('getFileUrl: файл не из этого материала → NOT_FOUND', async () => {
    const { service, prisma, files } = setup()
    prisma.material.findUnique.mockResolvedValue({
      id: 'm1',
      groupId: 'g1',
      teacher: {},
      media: [],
    })
    // Выборка ищет файл ВНУТРИ материала: чужой файл просто не находится.
    prisma.file.findFirst.mockResolvedValue(null)
    const err = await service
      .getFileUrl(user(Role.STUDENT, { groupId: 'g1' }), 'm1', 'f1')
      .catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
    expect(prisma.file.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'f1', materialId: 'm1' } }),
    )
    expect(files.getPresignedUrl).not.toHaveBeenCalled()
  })

  it('getFileUrl: преподаватель группы, где не ведёт занятий, → WRONG_SCOPE без ссылки', async () => {
    const { service, prisma, files } = setup()
    prisma.material.findUnique.mockResolvedValue({
      id: 'm1',
      groupId: 'g9',
      teacher: { id: 'other' },
      media: [],
    })
    const err = await service
      .getFileUrl(user(Role.TEACHER, { sub: 't1', universityId: 'uni1' }), 'm1', 'f1')
      .catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')
    expect(files.getPresignedUrl).not.toHaveBeenCalled()
  })

  it('getFileUrl: свой файл → ссылка и описание медиа', async () => {
    const { service, prisma, files } = setup()
    prisma.material.findUnique.mockResolvedValue({
      id: 'm1',
      groupId: 'g1',
      teacher: {},
      media: [],
    })
    prisma.file.findFirst.mockResolvedValue({ id: 'f1', variants: [] })
    files.getPresignedUrl.mockResolvedValue('https://minio/f1')
    const link = await service.getFileUrl(user(Role.STUDENT, { groupId: 'g1' }), 'm1', 'f1')
    expect(link).toMatchObject({ url: 'https://minio/f1', status: 'READY' })
    expect(Date.parse(link.expiresAt)).toBeGreaterThan(Date.now())
  })
})
