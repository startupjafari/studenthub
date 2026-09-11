import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { readableCode } from '../crypto/readable-code'
import type { ExportContext, ExportFormat } from './export-branding.types'

export interface ExportRecord {
  /** Внутренний идентификатор записи журнала. */
  id: string
  /** Короткий код для колонтитула и ссылки проверки: `7K3M9QAB`. */
  shortId: string
}

export interface RegisterExportInput {
  context: ExportContext
  format: ExportFormat
  /** Сколько строк или сообщений ушло в файл. Для документа — не задаётся. */
  rows?: number
  /**
   * Реквизиты официального документа — только для выданных бумаг (справка, транскрипт).
   * По ним страница проверки сверяет документ, который человек держит в руках.
   */
  document?: {
    subjectName: string
    documentNumber?: string
    issuerName?: string | null
  }
  ip?: string
  userAgent?: string
}

/** Что показывает публичная страница проверки. Персональных данных — минимум (см. ниже). */
export interface VerifiedExport {
  shortId: string
  kind: string
  documentNumber: string | null
  issuerName: string | null
  /** Фамилия с инициалами: «Оспанова А.Б.» — сверить хватает, собрать базу ФИО нельзя. */
  subject: string | null
  issuedAt: Date
  revokedAt: Date | null
}

/**
 * Журнал выгруженных документов (план брендирования, этап A6).
 *
 * Две роли сразу: журнал аудита («кто и что выгрузил») и источник данных для будущей
 * страницы проверки — короткий код из колонтитула ищут именно здесь.
 *
 * Почему отдельно от `AuditService`: там нет публичного идентификатора, и cron
 * `cleanAuditLogs` чистит записи старше 90 дней. Журнал выданных документов так терять
 * нельзя — справку на руках проверяют годами.
 */
@Injectable()
export class ExportRegistryService {
  private readonly logger = new Logger(ExportRegistryService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Записать выгрузку и выдать её короткий код.
   *
   * Сбой записи не роняет выгрузку — тот же принцип, что у `AuditService`: человек просил
   * файл, а не запись в журнале, и падение журнала не повод отказать. Но код в этом случае
   * остаётся «висячим»: по нему проверка ничего не найдёт, поэтому сбой обязан быть виден
   * в логах.
   *
   * ВАЖНО для официальных документов (справка, транскрипт): там такая деградация
   * недопустима — документ без записи в журнале непроверяем, и выдавать его нельзя.
   * Вызывающая сторона обязана проверить `null` и отказать.
   */
  async register(input: RegisterExportInput): Promise<ExportRecord | null> {
    const shortId = readableCode()
    try {
      const created = await this.prisma.documentExport.create({
        data: {
          shortId,
          userId: input.context.actor.id,
          kind: input.context.kind,
          format: input.format,
          // `undefined`, а не `null`: Prisma для nullable-Json ждёт либо значение, либо
          // отсутствие поля (plain null у неё зарезервирован под JsonNull).
          params: cleanParams(input.context.params) ?? undefined,
          rows: input.rows ?? null,
          subjectName: input.document?.subjectName ?? null,
          documentNumber: input.document?.documentNumber ?? null,
          issuerName: input.document?.issuerName ?? null,
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        select: { id: true, shortId: true },
      })
      return created
    } catch (error) {
      this.logger.error(
        `Не удалось записать выгрузку ${input.context.kind}/${input.format} в журнал: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return null
    }
  }

  /**
   * Отозвать выданные документы по номеру (номер документа = номер заявки).
   *
   * Ищем по номеру, а не по коду из бланка: код знает только тот, у кого документ на
   * руках, а отзывать приходится сотруднику, у которого перед глазами заявка. Уже
   * отозванные не трогаем — дата отзыва должна остаться первой, а не последней.
   *
   * Возвращает число отозванных: ноль означает «нечего отзывать», и вызывающая сторона
   * решает, ошибка это или нет.
   */
  async revokeByDocumentNumber(documentNumber: string, kind = 'certificate'): Promise<number> {
    const { count } = await this.prisma.documentExport.updateMany({
      where: { documentNumber, kind, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    return count
  }

  /**
   * Запись по короткому коду — для публичной страницы проверки.
   *
   * Отдаём минимум: тип документа, номер, кем выдан, дату и статус. ФИО — только фамилия
   * с инициалами: код короткий и подбираем, и по нему нельзя раздавать ни полные имена, ни
   * фильтры выгрузок, ни IP. Проверяющий держит документ в руках — ему нужно сверить, а не
   * узнать.
   *
   * Рабочие выгрузки (списки, чаты) тоже лежат в этой таблице, но проверять там нечего:
   * отдаём их так же скупо, страница покажет «это не официальный документ».
   */
  async findByShortId(shortId: string): Promise<VerifiedExport | null> {
    const found = await this.prisma.documentExport.findUnique({
      where: { shortId },
      select: {
        shortId: true,
        kind: true,
        documentNumber: true,
        issuerName: true,
        subjectName: true,
        createdAt: true,
        revokedAt: true,
      },
    })
    if (!found) return null
    return {
      shortId: found.shortId,
      kind: found.kind,
      documentNumber: found.documentNumber,
      issuerName: found.issuerName,
      subject: maskName(found.subjectName),
      issuedAt: found.createdAt,
      revokedAt: found.revokedAt,
    }
  }
}

/**
 * Параметры выборки для журнала: пустые значения выбрасываем, чтобы в записи не оседали
 * `{"search": null, "role": null}` — по такому фильтру ничего не восстановить, а место и
 * внимание он занимает.
 */
function cleanParams(
  params: Record<string, unknown> | undefined,
): Prisma.InputJsonObject | undefined {
  if (!params) return undefined
  // Значения приводим к строкам: в журнал идут условия выборки, а не произвольный JSON,
  // и строковое представление разбирается глазами без догадок о типе.
  const entries = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => [key, String(value)] as const)
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

/**
 * «Оспанова Аружан Бауыржановна» → «Оспанова А.Б.».
 *
 * Фамилия целиком, остальное инициалами: этого хватает, чтобы сверить с бумагой, и мало,
 * чтобы собрать по перебору кодов список студентов с именами.
 */
function maskName(fullName: string | null): string | null {
  if (!fullName) return null
  const [surname, ...rest] = fullName.trim().split(/\s+/)
  if (!surname) return null
  const initials = rest
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}.`)
    .join('')
  return initials ? `${surname} ${initials}` : surname
}
