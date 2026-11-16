import { Injectable } from '@nestjs/common'
import type {
  ClearanceCertificateItem,
  ClearanceListQueryInput,
  RevokeClearanceInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import { readableCode } from '../../common/crypto/readable-code'
import { renderQrPngDataUrl } from '../../common/qr/qr-raster'
import { ExportBrandingService } from '../../common/export/export-branding.service'
import {
  ExportRegistryService,
  type IssuedDocument,
} from '../../common/export/export-registry.service'
import type { ExportContext, ExportLocale } from '../../common/export/export-branding.types'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { UNSETTLED_DEBT_WHERE } from './library-loans.service'
import { lockReader } from './library-holds'
import { LIBRARY_CLEARANCE_LABELS, renderLibraryClearancePdf } from './library-clearance-pdf'
import { libraryConflict, librarianLibrary, readerLibrary, staffLibrary } from './library-scope'

// Справка «задолженностей в библиотеке нет» с кодом проверки (Фаза 21.C4, docs/PROJECT.md
// §3.11). По образцу справки об обучении (ApplicationProcessService.issueStudyCertificate):
// сначала запись в журнале выданных документов (`DocumentExport`, вид `library-clearance`),
// потом PDF с её кодом и QR на `/verify/<код>` — та же публичная проверка. Подделку вёрстки
// проверка не подтвердит: кода нет в журнале.
//
// Выпускает справку сам студент — когда долгов нет. Проверка долгов и запись в журнал идут
// под локом читателя: выдача книги в тот же момент (она берёт тот же лок) не проскочит
// между ними. Отзывает библиотекарь своего вуза; ошибочный возврат книги, отменённый после
// выдачи справки, отзывает её сам (LibraryLoansService.cancelReturn).

export const CLEARANCE_KIND = 'library-clearance' as const

/** «Мои справки» — последние выданные; больше студенту и не нужно. */
const MY_CERTIFICATES = 20

@Injectable()
export class LibraryClearanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly exports: ExportRegistryService,
    private readonly branding: ExportBrandingService,
  ) {}

  /**
   * PDF справки студенту. Долг (книга на руках или утерянная непогашенная) — `409
   * debts`. Возвращает файл, его имя и код проверки.
   */
  async issueCertificate(
    actor: JwtPayload,
    locale: ExportLocale,
    ctx: RequestContext,
  ): Promise<{ buffer: Buffer; filename: string; code: string }> {
    const universityId = readerLibrary(actor)
    const reader = await this.prisma.user.findFirst({
      where: { id: actor.sub, deletedAt: null },
      select: {
        firstName: true,
        lastName: true,
        middleName: true,
        studentCardNumber: true,
        group: { select: { name: true } },
        faculty: { select: { name: true } },
        university: { select: { name: true, timezone: true } },
      },
    })
    if (!reader) throw new AppException('NOT_FOUND', 'Пользователь не найден')
    const debtWhere = { readerId: actor.sub, universityId, ...UNSETTLED_DEBT_WHERE }
    // Быстрый отказ без транзакции; под локом — ещё раз.
    if ((await this.prisma.loan.count({ where: debtWhere })) > 0) throw this.debtsConflict()

    const fullName = [reader.lastName, reader.firstName, reader.middleName]
      .filter(Boolean)
      .join(' ')
    const universityName = reader.university?.name ?? ''
    const context: ExportContext = {
      kind: CLEARANCE_KIND,
      actor: { id: actor.sub, fullName },
      locale,
      timezone: reader.university?.timezone || 'Asia/Almaty',
      generatedAt: new Date(),
      // По этим реквизитам библиотекарь видит журнал справок своего вуза и отзывает их.
      params: { universityId, readerId: actor.sub },
    }
    const number = `LIB-${context.generatedAt.getUTCFullYear()}-${readableCode(6)}`
    const record = await this.prisma.$transaction(async (tx) => {
      await lockReader(tx, actor.sub)
      if ((await tx.loan.count({ where: debtWhere })) > 0) throw this.debtsConflict()
      // Официальный документ без записи в журнале непроверяем: сбой журнала откатывает
      // выдачу, а не выдаёт бумагу «без кода».
      return this.exports.registerWithin(tx, {
        context,
        format: 'pdf',
        document: { subjectName: fullName, documentNumber: number, issuerName: universityName },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      })
    })

    const withCode: ExportContext = { ...context, shortId: record.shortId }
    let buffer: Buffer
    try {
      const verifyUrl = `${this.branding.publicUrl}/verify/${record.shortId}`
      buffer = await renderLibraryClearancePdf({
        number,
        verificationCode: record.shortId,
        verificationUrl: verifyUrl,
        verificationQr: await renderQrPngDataUrl(verifyUrl, { width: 256 }),
        universityName,
        reader: {
          name: fullName,
          faculty: reader.faculty?.name ?? null,
          group: reader.group?.name ?? null,
          studentCardNumber: reader.studentCardNumber,
        },
        issuedAt: this.branding.dateTime(withCode),
        labels: LIBRARY_CLEARANCE_LABELS[locale],
        branding: await this.branding.pdfBranding(withCode),
      })
    } catch (e) {
      // Код уже в журнале, а бумаги под ним нет: проверка не должна его подтверждать.
      await this.exports
        .revokeMatching(CLEARANCE_KIND, { readerId: actor.sub }, { shortId: record.shortId })
        .catch(() => undefined)
      throw e
    }
    await this.audit.record({
      userId: actor.sub,
      action: 'library_clearance_issued',
      entity: 'DocumentExport',
      entityId: record.id,
      metadata: { universityId, code: record.shortId, number },
      ...ctx,
    })
    return {
      buffer,
      filename: this.branding.filename(withCode, 'pdf'),
      code: record.shortId,
    }
  }

  /** Свои справки — студенту: коды и статус (отозванную он видит здесь же). */
  async mine(actor: JwtPayload): Promise<ClearanceCertificateItem[]> {
    const universityId = readerLibrary(actor)
    const { items } = await this.exports.listIssued(
      CLEARANCE_KIND,
      { universityId, readerId: actor.sub },
      { status: 'all', skip: 0, take: MY_CERTIFICATES },
    )
    return items.map(toItem)
  }

  /** Журнал справок вуза — библиотекарю и админу вуза. */
  async list(
    actor: JwtPayload,
    query: ClearanceListQueryInput,
  ): Promise<Paginated<ClearanceCertificateItem>> {
    const universityId = staffLibrary(actor)
    const { items, total } = await this.exports.listIssued(
      CLEARANCE_KIND,
      { universityId, ...(query.readerId ? { readerId: query.readerId } : {}) },
      { status: query.status, skip: (query.page - 1) * query.limit, take: query.limit },
    )
    return new Paginated(items.map(toItem), { total })
  }

  /**
   * Отзыв справки библиотекарем: бумага у человека остаётся, но проверка по коду с этого
   * момента показывает «отозван». Чужой вуз и несуществующий код — одинаковый `404`.
   */
  async revoke(
    actor: JwtPayload,
    rawCode: string,
    input: RevokeClearanceInput,
    ctx: RequestContext,
  ): Promise<ClearanceCertificateItem> {
    const universityId = librarianLibrary(actor)
    const code = rawCode.trim().toUpperCase()
    const found = await this.exports.findIssued(CLEARANCE_KIND, code)
    if (!found || found.params.universityId !== universityId) {
      throw new AppException('NOT_FOUND', 'Справка не найдена')
    }
    if (found.revokedAt) throw libraryConflict('alreadyRevoked', 'Справка уже отозвана')
    const revoked = await this.exports.revokeMatching(
      CLEARANCE_KIND,
      { universityId },
      { shortId: code },
    )
    if (revoked === 0) throw libraryConflict('alreadyRevoked', 'Справка уже отозвана')
    await this.audit.record({
      userId: actor.sub,
      action: 'library_clearance_revoked',
      entity: 'DocumentExport',
      entityId: code,
      metadata: {
        universityId,
        code,
        readerId: found.params.readerId ?? null,
        reason: input.reason,
      },
      ...ctx,
    })
    const after = await this.exports.findIssued(CLEARANCE_KIND, code)
    return toItem(after ?? { ...found, revokedAt: new Date() })
  }

  private debtsConflict(): AppException {
    return libraryConflict(
      'debts',
      'За вами числятся книги библиотеки — справку выдать нельзя, сначала верните их',
    )
  }
}

function toItem(doc: IssuedDocument): ClearanceCertificateItem {
  return {
    code: doc.shortId,
    number: doc.documentNumber,
    issuedAt: doc.createdAt.toISOString(),
    revokedAt: doc.revokedAt?.toISOString() ?? null,
    reader: { id: doc.params.readerId ?? null, name: doc.subjectName },
  }
}
