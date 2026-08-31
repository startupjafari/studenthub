import { Role } from '@studenthub/shared-types'
import { ResumeService } from './resume.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

// Настоящий рендер PDF грузит react-pdf и файл шрифта — это секунды на каждый тест.
// Сборка данных резюме и правила публикации проверяются здесь; сам рендер — отдельно.
jest.mock('./resume-pdf', () => ({
  renderResumePdf: jest.fn(async () => Buffer.from('%PDF-stub')),
}))

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

const student: JwtPayload = {
  sub: 'stu-1',
  role: Role.STUDENT,
  universityId: 'uni-1',
  facultyId: null,
  groupId: null,
}

function sourceUser(over: Record<string, unknown> = {}) {
  return {
    firstName: 'Аружан',
    lastName: 'Оспанова',
    headline: 'Frontend',
    email: 'aruzhan@uni.kz',
    phone: '+7 700 000 00 00',
    country: 'Алматы',
    website: null,
    specialty: 'Информационные системы',
    course: 3,
    graduationYear: 2027,
    skills: ['React'],
    languages: ['ru'],
    university: { name: 'Алатау' },
    careerProfile: { about: 'Ищу стажировку' },
    portfolioItems: [
      {
        kind: 'PROJECT',
        title: 'Трекер',
        organization: null,
        description: null,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-06-01'),
      },
      {
        kind: 'EXPERIENCE',
        title: 'Стажёр',
        organization: 'Алатау Софт',
        description: null,
        startDate: null,
        endDate: null,
      },
    ],
    documents: [{ title: 'Курс по вебу', issuedBy: 'Алатау', issuedAt: new Date('2026-05-01') }],
    ...over,
  }
}

function setup(resume: Record<string, unknown> | null = null) {
  const prisma = {
    resume: {
      findUnique: jest.fn().mockResolvedValue(resume),
      findFirst: jest.fn().mockResolvedValue(resume),
      upsert: jest.fn(),
    },
    user: { findFirst: jest.fn().mockResolvedValue(sourceUser()) },
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const service = new ResumeService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  )
  return { service, prisma, audit }
}

describe('ResumeService — публичная ссылка', () => {
  it('включение публикации выдаёт slug', async () => {
    const { service, prisma } = setup(null)

    await service.update(student, { published: true }, ctx)

    const created = prisma.resume.upsert.mock.calls[0]?.[0]?.create as { publicSlug: string }
    expect(created.publicSlug).toBeTruthy()
  })

  it('выключение стирает slug — старая ссылка перестаёт работать', async () => {
    const { service, prisma } = setup({ publicSlug: 'abc123' })

    await service.update(student, { published: false }, ctx)

    const update = prisma.resume.upsert.mock.calls[0]?.[0]?.update as {
      publicSlug: string | null
      publishedAt: Date | null
    }
    expect(update.publicSlug).toBeNull()
    expect(update.publishedAt).toBeNull()
  })

  it('повторное включение не меняет уже выданный slug', async () => {
    const { service, prisma } = setup({ publicSlug: 'abc123' })

    await service.update(student, { published: true }, ctx)

    const update = prisma.resume.upsert.mock.calls[0]?.[0]?.update as { publicSlug: string }
    expect(update.publicSlug).toBe('abc123')
  })

  it('смена публичности пишется в аудит', async () => {
    const { service, audit } = setup(null)
    await service.update(student, { published: true }, ctx)
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'resume_published' }),
    )
  })

  it('несуществующая ссылка — NOT_FOUND', async () => {
    const { service, prisma } = setup(null)
    prisma.resume.findFirst.mockResolvedValue(null)
    await expect(service.publicBySlug('nope')).rejects.toBeInstanceOf(AppException)
  })
})

describe('ResumeService — контакты в публичном резюме', () => {
  it('по умолчанию контактов в публичной версии нет', async () => {
    const { service } = setup({
      userId: 'stu-1',
      title: 'Резюме',
      includeContacts: false,
      updatedAt: new Date(),
    })

    const result = await service.publicBySlug('abc123')

    // Ссылку могут переслать куда угодно — email не должен уезжать вместе с ней молча.
    expect(result.contacts).toEqual([])
  })

  it('при явном включении контакты отдаются', async () => {
    const { service } = setup({
      userId: 'stu-1',
      title: 'Резюме',
      includeContacts: true,
      updatedAt: new Date(),
    })

    const result = await service.publicBySlug('abc123')

    expect(result.contacts).toContain('aruzhan@uni.kz')
  })
})

describe('ResumeService — сборка содержимого', () => {
  it('портфолио раскладывается по разделам', async () => {
    const { service } = setup({ userId: 'stu-1', includeContacts: false, updatedAt: new Date() })

    const result = await service.publicBySlug('abc123')

    expect(result.projects.map((p) => p.title)).toEqual(['Трекер'])
    expect(result.experience.map((e) => e.title)).toEqual(['Стажёр'])
  })

  it('подтверждённые вузом сертификаты помечены, самозаявленные — нет', async () => {
    const { service } = setup({ userId: 'stu-1', includeContacts: false, updatedAt: new Date() })

    const result = await service.publicBySlug('abc123')

    expect(result.certificates).toHaveLength(1)
    expect(result.certificates[0]?.verified).toBe(true)
  })

  it('период собирается из годов, одинаковые годы не дублируются', async () => {
    const { service, prisma } = setup({
      userId: 'stu-1',
      includeContacts: false,
      updatedAt: new Date(),
    })
    prisma.user.findFirst.mockResolvedValue(
      sourceUser({
        portfolioItems: [
          {
            kind: 'PROJECT',
            title: 'Год',
            organization: null,
            description: null,
            startDate: new Date('2026-01-01'),
            endDate: new Date('2026-12-01'),
          },
        ],
      }),
    )

    const result = await service.publicBySlug('abc123')

    expect(result.projects[0]?.period).toBe('2026')
  })

  it('удалённый профиль — NOT_FOUND, а не пустое резюме', async () => {
    const { service, prisma } = setup({
      userId: 'stu-1',
      includeContacts: false,
      updatedAt: new Date(),
    })
    prisma.user.findFirst.mockResolvedValue(null)
    await expect(service.publicBySlug('abc123')).rejects.toBeInstanceOf(AppException)
  })
})
