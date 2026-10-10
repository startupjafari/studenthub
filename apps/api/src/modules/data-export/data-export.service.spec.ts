import { Role } from '@studenthub/shared-types'
import { DataExportService } from './data-export.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { ExportBrandingService } from '../../common/export/export-branding.service'
import type { ExportRegistryService } from '../../common/export/export-registry.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

// Модели, из которых собирается архив. Список живёт в тесте отдельно от сервиса
// намеренно: если в сервисе появится новый источник, мок его не отдаст и тест упадёт —
// ровно так и должно быть замечено, что в выгрузку добавили таблицу.
const MODELS = [
  'file',
  'post',
  'comment',
  'reaction',
  'postBookmark',
  'chatMember',
  'message',
  'document',
  'documentSubmission',
  'grade',
  'attendance',
  'submission',
  'examResult',
  'application',
  'eventParticipant',
  'portfolioItem',
  'friendship',
  'notification',
  'invite',
  'auditLog',
] as const

function account(over: Record<string, unknown> = {}) {
  return {
    id: 'u-1',
    email: 'student@u.kz',
    firstName: 'Асем',
    lastName: 'Абишева',
    timezone: null,
    university: { name: 'Университет', timezone: 'Asia/Almaty' },
    faculty: { name: 'Юридический' },
    group: { name: 'ЮР-26-1' },
    phone: '+7 700 000 00 00',
    twoFactorEnabled: true,
    ...over,
  }
}

function setup() {
  const prisma: Record<string, { findMany: jest.Mock } | unknown> = {
    user: { findFirst: jest.fn().mockResolvedValue(account()) },
  }
  for (const model of MODELS) {
    prisma[model] = { findMany: jest.fn().mockResolvedValue([]) }
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const exports = { register: jest.fn().mockResolvedValue({ id: 'e1', shortId: 'ABCD1234' }) }
  const branding = {
    brand: 'StudentHub',
    publicUrl: 'https://studenthub.kz',
    version: '1.4.0',
    filename: jest.fn().mockReturnValue('studenthub_my-data_2026-10-11.json'),
  }
  const service = new DataExportService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    branding as unknown as ExportBrandingService,
    exports as unknown as ExportRegistryService,
  )
  return { service, prisma: prisma as Record<string, { findMany: jest.Mock }>, audit, exports }
}

const viewer: JwtPayload = {
  sub: 'u-1',
  role: Role.STUDENT,
  universityId: 'uni-1',
  facultyId: 'fac-1',
  groupId: 'grp-1',
}

describe('DataExportService — состав архива', () => {
  it('каждый раздел читается только по своему пользователю', async () => {
    const { service, prisma } = setup()
    await service.exportPersonalData(viewer, 'ru', ctx)

    for (const model of MODELS) {
      const where = prisma[model].findMany.mock.calls[0][0].where as Record<string, unknown>
      const mine = JSON.stringify(where).includes('"u-1"')
      expect(mine).toBe(true)
    }
    expect(prisma.user.findFirst).toHaveBeenCalled()
  })

  it('у каждой выборки есть потолок строк', async () => {
    const { service, prisma } = setup()
    await service.exportPersonalData(viewer, 'ru', ctx)
    for (const model of MODELS) {
      expect(prisma[model].findMany.mock.calls[0][0].take).toBeGreaterThan(0)
    }
  })

  it('усечённый раздел помечен и обрезан до потолка', async () => {
    const { service, prisma } = setup()
    // Потолок раздела — 5000; отдаём на одну строку больше, чем влезает.
    prisma.message.findMany.mockResolvedValue(
      Array.from({ length: 5001 }, (_, i) => ({ id: `m${i}`, content: 'текст' })),
    )
    const { body } = await service.exportPersonalData(viewer, 'ru', ctx)
    const archive = JSON.parse(body) as {
      sections: Record<string, { count: number; truncated: boolean }>
    }
    expect(archive.sections.messages.truncated).toBe(true)
    expect(archive.sections.messages.count).toBe(5000)
    expect(archive.sections.posts.truncated).toBe(false)
  })
})

describe('DataExportService — что наружу не уходит', () => {
  it('ключи доступа в файл не попадают', async () => {
    const { service, prisma } = setup()
    // Даже если выборка вдруг принесёт лишнее, в файле этого быть не должно.
    prisma.invite.findMany.mockResolvedValue([{ role: 'STUDENT', status: 'USED' }])
    const { body } = await service.exportPersonalData(viewer, 'ru', ctx)

    for (const secret of [
      'passwordHash',
      'twoFactorSecret',
      'twoFactorBackupCodes',
      'refreshToken',
      'tokenHash',
      '"token"',
    ]) {
      expect(body).not.toContain(secret)
    }
    // Флаг «двухфакторная включена» — это не секрет, он остаётся.
    expect(body).toContain('twoFactorEnabled')
  })

  it('номер документа маскируется до последних четырёх цифр', async () => {
    const { service, prisma } = setup()
    prisma.document.findMany.mockResolvedValue([
      { id: 'd1', title: 'Удостоверение', number: 'AB1234567890', status: 'VERIFIED' },
    ])
    const { body } = await service.exportPersonalData(viewer, 'ru', ctx)

    expect(body).not.toContain('AB1234567890')
    expect(body).toContain('"numberLast4": "7890"')
  })

  it('из дружбы остаётся вторая сторона и дата, без контактов', async () => {
    const { service, prisma } = setup()
    prisma.friendship.findMany.mockResolvedValue([
      {
        createdAt: new Date('2026-01-01'),
        requester: { id: 'u-1', firstName: 'Асем', lastName: 'Абишева' },
        addressee: { id: 'u-2', firstName: 'Ержан', lastName: 'Абишев' },
      },
    ])
    const { body } = await service.exportPersonalData(viewer, 'ru', ctx)
    const archive = JSON.parse(body) as { sections: { friends: { items: { id: string }[] } } }

    expect(archive.sections.friends.items[0]).toMatchObject({ id: 'u-2', firstName: 'Ержан' })
  })
})

describe('DataExportService — след в журналах', () => {
  it('выгрузка попадает и в аудит, и в реестр выгрузок — без самих данных', async () => {
    const { service, audit, exports } = setup()
    await service.exportPersonalData(viewer, 'ru', ctx)

    expect(audit.record.mock.calls[0][0]).toMatchObject({
      userId: 'u-1',
      action: 'personal_data_export',
      entity: 'User',
    })
    const registered = exports.register.mock.calls[0][0] as {
      context: { kind: string; timezone: string }
      format: string
    }
    expect(registered.format).toBe('json')
    expect(registered.context.kind).toBe('my-data')
    // Дата в имени файла считается в таймзоне вуза, а не сервера.
    expect(registered.context.timezone).toBe('Asia/Almaty')
  })

  it('удалённый аккаунт выгрузку не получает', async () => {
    const { service, prisma } = setup()
    ;(prisma.user as unknown as { findFirst: jest.Mock }).findFirst.mockResolvedValue(null)
    const err = await service.exportPersonalData(viewer, 'ru', ctx).catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
  })
})
