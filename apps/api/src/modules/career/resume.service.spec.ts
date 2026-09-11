import { Role } from '@studenthub/shared-types'
import { ResumeService } from './resume.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { ExportBrandingService } from '../../common/export/export-branding.service'
import type { ExportRegistryService } from '../../common/export/export-registry.service'
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
    // Таймзона вуза идёт в дату выгрузки PDF (см. describe «PDF»).
    university: { name: 'Алатау', timezone: 'Asia/Almaty' },
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
  // Брендирование проверяется своим тестом (common/export); здесь важно лишь, что сервис
  // спрашивает у него имя файла и не собирает его сам.
  const branding = {
    pdfBranding: jest.fn().mockResolvedValue({
      metadata: {},
      logo: null,
      generatedLine: 'Сформировано',
      footerLine: () => 'StudentHub',
    }),
    filename: jest.fn().mockReturnValue('studenthub_resume_2026-09-13.pdf'),
  }
  const exportRegistry = {
    register: jest.fn().mockResolvedValue({ id: 'e-1', shortId: 'ABCD2345' }),
  }
  const service = new ResumeService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    branding as unknown as ExportBrandingService,
    exportRegistry as unknown as ExportRegistryService,
  )
  return { service, prisma, audit, branding, exportRegistry }
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

describe('ResumeService — PDF', () => {
  it('отдаёт имя файла от службы брендирования, а не собирает своё', async () => {
    const { service, branding } = setup()
    const result = await service.pdf(student, EMPTY_PDF_LABELS, 'ru')

    expect(result.filename).toBe('studenthub_resume_2026-09-13.pdf')
    expect(branding.filename).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'resume' }),
      'pdf',
    )
  })

  it('в контекст выгрузки уходят студент и таймзона вуза', async () => {
    const { service, branding } = setup()
    await service.pdf(student, EMPTY_PDF_LABELS, 'kk')

    expect(branding.pdfBranding).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: 'kk',
        timezone: 'Asia/Almaty',
        actor: expect.objectContaining({ id: 'stu-1', fullName: 'Аружан Оспанова' }),
      }),
    )
  })
})

/** Подписи разделов приходят с фронта; для этих тестов их содержание неважно. */
const EMPTY_PDF_LABELS = {
  about: '',
  education: '',
  skills: '',
  languages: '',
  experience: '',
  projects: '',
  certificates: '',
  verified: '',
  generated: '',
}
