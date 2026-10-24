import { AppException } from '../exceptions/app.exception'
import { ExportVerifyController } from './export-verify.controller'
import type { ExportRegistryService, VerifiedExport } from './export-registry.service'

// D-F23: публичная страница проверки документа по коду из бланка.
function setup(found: VerifiedExport | null) {
  const exports = { findByShortId: jest.fn().mockResolvedValue(found) }
  const controller = new ExportVerifyController(exports as unknown as ExportRegistryService)
  return { controller, exports }
}

const issued: VerifiedExport = {
  shortId: 'JT9ZPNDD',
  kind: 'certificate',
  documentNumber: 'SH-2026-000042',
  issuerName: 'Алатауский университет',
  subject: 'Оспанова А.Б.',
  issuedAt: new Date('2026-09-12T21:30:00Z'),
  revokedAt: null,
}

describe('ExportVerifyController', () => {
  it('действующий документ — VALID с реквизитами', async () => {
    const { controller } = setup(issued)
    await expect(controller.verify('JT9ZPNDD')).resolves.toEqual({
      code: 'JT9ZPNDD',
      kind: 'certificate',
      number: 'SH-2026-000042',
      issuer: 'Алатауский университет',
      subject: 'Оспанова А.Б.',
      issuedAt: issued.issuedAt,
      revokedAt: null,
      status: 'VALID',
    })
  })

  it('отозванный — REVOKED с датой отзыва', async () => {
    const revokedAt = new Date('2026-10-01T10:00:00Z')
    const { controller } = setup({ ...issued, revokedAt })
    const result = await controller.verify('JT9ZPNDD')
    expect(result.status).toBe('REVOKED')
    expect(result.revokedAt).toEqual(revokedAt)
  })

  it('код нормализуется: пробелы и регистр не мешают', async () => {
    const { controller, exports } = setup(issued)
    await controller.verify('  jt9zpndd ')
    expect(exports.findByShortId).toHaveBeenCalledWith('JT9ZPNDD')
  })

  // Нет кода и код рабочей выгрузки (её реестр не отдаёт) — один и тот же ответ.
  it('не найден — NOT_FOUND', async () => {
    const { controller } = setup(null)
    const err = await controller.verify('ABCD2345').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AppException)
    expect((err as AppException).code).toBe('NOT_FOUND')
  })
})
