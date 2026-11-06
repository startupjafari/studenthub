import { Role } from '@studenthub/shared-types'
import { LibraryClearanceService } from './library-clearance.service'
import { renderLibraryClearancePdf } from './library-clearance-pdf'
import { UNSETTLED_DEBT_WHERE } from './library-loans.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

// Справка «задолженностей нет» с кодом проверки (Фаза 21.C4).

jest.mock('./library-clearance-pdf', () => ({
  ...jest.requireActual('./library-clearance-pdf'),
  renderLibraryClearancePdf: jest.fn(async () => Buffer.from('%PDF-stub')),
}))
jest.mock('../../common/qr/qr-raster', () => ({
  renderQrPngDataUrl: jest.fn(async () => 'data:image/png;base64,QR'),
}))

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }
const student: JwtPayload = {
  sub: 'stu-1',
  role: Role.STUDENT,
  universityId: 'uni-1',
  facultyId: null,
  groupId: null,
}
const librarian: JwtPayload = { ...student, sub: 'lib-1', role: Role.LIBRARIAN }

function issued(overrides: Record<string, unknown> = {}) {
  return {
    shortId: 'K7M3QABC',
    documentNumber: 'LIB-2026-ABCDEF',
    subjectName: 'Сейтова Айгерим Нурлановна',
    issuedById: 'stu-1',
    params: { universityId: 'uni-1', readerId: 'stu-1' },
    createdAt: new Date('2026-11-06T10:00:00Z'),
    revokedAt: null as Date | null,
    ...overrides,
  }
}

function setup({ debts = 0, debtsInTx }: { debts?: number; debtsInTx?: number } = {}) {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    loan: { count: jest.fn().mockResolvedValue(debtsInTx ?? debts) },
  }
  const prisma = {
    user: {
      findFirst: jest.fn().mockResolvedValue({
        firstName: 'Айгерим',
        lastName: 'Сейтова',
        middleName: 'Нурлановна',
        studentCardNumber: 'SC-1',
        group: { name: 'ИТ-23-1' },
        faculty: { name: 'ИТ' },
        university: { name: 'КазНУ', timezone: 'Asia/Almaty' },
      }),
    },
    loan: { count: jest.fn().mockResolvedValue(debts) },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const exports = {
    registerWithin: jest.fn().mockResolvedValue({ id: 'exp-1', shortId: 'K7M3QABC' }),
    revokeMatching: jest.fn().mockResolvedValue(1),
    listIssued: jest.fn().mockResolvedValue({ items: [issued()], total: 1 }),
    findIssued: jest.fn().mockResolvedValue(issued()),
  }
  const branding = {
    publicUrl: 'https://studenthub.app',
    dateTime: jest.fn().mockReturnValue('06.11.2026 15:00'),
    pdfBranding: jest.fn().mockResolvedValue({}),
    filename: jest.fn().mockReturnValue('studenthub_library-clearance_2026-11-06.pdf'),
  }
  const service = new LibraryClearanceService(
    prisma as never,
    audit as never,
    exports as never,
    branding as never,
  )
  return { service, prisma, tx, audit, exports, branding }
}

describe('LibraryClearanceService — выдача справки', () => {
  beforeEach(() => jest.mocked(renderLibraryClearancePdf).mockClear())

  it('без долгов: запись в журнале под локом читателя, затем PDF с её кодом и QR', async () => {
    const { service, tx, exports } = setup()
    const result = await service.issueCertificate(student, 'ru', ctx)
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
    expect(tx.loan.count).toHaveBeenCalledWith({
      where: { readerId: 'stu-1', universityId: 'uni-1', ...UNSETTLED_DEBT_WHERE },
    })
    expect(exports.registerWithin).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        format: 'pdf',
        context: expect.objectContaining({
          kind: 'library-clearance',
          params: { universityId: 'uni-1', readerId: 'stu-1' },
        }),
        document: {
          subjectName: 'Сейтова Айгерим Нурлановна',
          documentNumber: expect.stringMatching(/^LIB-\d{4}-[A-Z0-9]{6}$/),
          issuerName: 'КазНУ',
        },
      }),
    )
    expect(renderLibraryClearancePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        verificationCode: 'K7M3QABC',
        verificationUrl: 'https://studenthub.app/verify/K7M3QABC',
        verificationQr: 'data:image/png;base64,QR',
      }),
    )
    expect(result).toEqual({
      buffer: Buffer.from('%PDF-stub'),
      filename: 'studenthub_library-clearance_2026-11-06.pdf',
      code: 'K7M3QABC',
    })
  })

  it('книга на руках — 409 debts, в журнал ничего не пишется', async () => {
    const { service, exports } = setup({ debts: 1 })
    await expect(service.issueCertificate(student, 'ru', ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: [expect.objectContaining({ field: 'debts' })],
    })
    expect(exports.registerWithin).not.toHaveBeenCalled()
  })

  it('книгу выдали между проверкой и записью — отказ под локом', async () => {
    const { service, exports } = setup({ debts: 0, debtsInTx: 1 })
    await expect(service.issueCertificate(student, 'ru', ctx)).rejects.toMatchObject({
      details: [expect.objectContaining({ field: 'debts' })],
    })
    expect(exports.registerWithin).not.toHaveBeenCalled()
  })

  it('PDF не собрался — код из журнала отзывается, проверка его не подтвердит', async () => {
    const { service, exports } = setup()
    jest.mocked(renderLibraryClearancePdf).mockRejectedValueOnce(new Error('font'))
    await expect(service.issueCertificate(student, 'ru', ctx)).rejects.toThrow('font')
    expect(exports.revokeMatching).toHaveBeenCalledWith(
      'library-clearance',
      { readerId: 'stu-1' },
      { shortId: 'K7M3QABC' },
    )
  })

  it('выдаёт справку только читатель (студент, староста)', async () => {
    const { service } = setup()
    await expect(service.issueCertificate(librarian, 'ru', ctx)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })
})

describe('LibraryClearanceService — журнал и отзыв', () => {
  it('журнал вуза: только справки своего вуза, фильтр по читателю', async () => {
    const { service, exports } = setup()
    const page = await service.list(librarian, {
      page: 2,
      limit: 10,
      status: 'active',
      readerId: 'stu-1',
    })
    expect(exports.listIssued).toHaveBeenCalledWith(
      'library-clearance',
      { universityId: 'uni-1', readerId: 'stu-1' },
      { status: 'active', skip: 10, take: 10 },
    )
    expect(page.items).toEqual([
      {
        code: 'K7M3QABC',
        number: 'LIB-2026-ABCDEF',
        issuedAt: '2026-11-06T10:00:00.000Z',
        revokedAt: null,
        reader: { id: 'stu-1', name: 'Сейтова Айгерим Нурлановна' },
      },
    ])
  })

  it('отзыв: по коду своего вуза, с причиной в аудите', async () => {
    const { service, exports, audit } = setup()
    exports.findIssued
      .mockResolvedValueOnce(issued())
      .mockResolvedValueOnce(issued({ revokedAt: new Date('2026-11-07T08:00:00Z') }))
    const item = await service.revoke(
      librarian,
      ' k7m3qabc ',
      { reason: 'Книга не вернулась' },
      ctx,
    )
    expect(exports.findIssued).toHaveBeenCalledWith('library-clearance', 'K7M3QABC')
    expect(exports.revokeMatching).toHaveBeenCalledWith(
      'library-clearance',
      { universityId: 'uni-1' },
      { shortId: 'K7M3QABC' },
    )
    expect(item.revokedAt).toBe('2026-11-07T08:00:00.000Z')
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'library_clearance_revoked',
        metadata: expect.objectContaining({ reason: 'Книга не вернулась', readerId: 'stu-1' }),
      }),
    )
  })

  it('справка чужого вуза — 404, как несуществующая', async () => {
    const { service, exports } = setup()
    exports.findIssued.mockResolvedValue(
      issued({ params: { universityId: 'uni-2', readerId: 'x' } }),
    )
    await expect(
      service.revoke(librarian, 'K7M3QABC', { reason: 'ошибка' }, ctx),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(exports.revokeMatching).not.toHaveBeenCalled()
  })

  it('уже отозванная — 409 alreadyRevoked', async () => {
    const { service, exports } = setup()
    exports.findIssued.mockResolvedValue(issued({ revokedAt: new Date() }))
    await expect(
      service.revoke(librarian, 'K7M3QABC', { reason: 'ошибка' }, ctx),
    ).rejects.toMatchObject({ details: [expect.objectContaining({ field: 'alreadyRevoked' })] })
  })

  it('отзывает только библиотекарь', async () => {
    const { service } = setup()
    await expect(
      service.revoke(
        { ...librarian, role: Role.UNIVERSITY_ADMIN },
        'K7M3QABC',
        { reason: 'x' },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
