import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { advisoryXactLock } from '../prisma/advisory-lock'
import { readableCode } from '../crypto/readable-code'
import type { ExportContext, ExportFormat, ExportKind } from './export-branding.types'

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

/**
 * Виды выгрузок, которые проверяются по коду публично. Только официальные документы: их код
 * печатается в бланке (ExportContext.shortId). Рабочие выгрузки (списки, переписка, резюме,
 * «мои данные») лежат в том же журнале, но кода в файле не несут — и раскрывать по их коду
 * анонимному посетителю вид выгрузки и её дату незачем.
 */
export const VERIFIABLE_EXPORT_KINDS: readonly ExportKind[] = ['certificate']

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
    try {
      return await this.create(this.prisma, input)
    } catch (error) {
      this.logFailure(input, error)
      return null
    }
  }

  /**
   * Зарегистрировать официальный документ, только если по его номеру нет действующего.
   *
   * Проверка «действующего нет» и запись — под транзакционным advisory-локом по номеру:
   * два одновременных «Сформировать справку» раньше оба проходили проверку чтением и
   * выпускали две действующие справки с разными кодами. Под локом второй запрос ждёт
   * первого и видит его запись. Лок держится только на эти два запроса — рендер и выдача
   * идут уже после, без открытой транзакции.
   *
   * `'active'` — действующий документ с этим номером уже есть; `null` — сбой журнала (как
   * у `register`: официальный документ без записи выдавать нельзя, решает вызывающий).
   */
  async registerExclusive(
    input: RegisterExportInput & { document: { documentNumber: string } },
  ): Promise<ExportRecord | 'active' | null> {
    const { documentNumber } = input.document
    const kind = input.context.kind
    try {
      return await this.prisma.$transaction(async (tx) => {
        await advisoryXactLock(tx, `export-document:${kind}:${documentNumber}`)
        const active = await tx.documentExport.count({
          where: { documentNumber, kind, revokedAt: null },
        })
        if (active > 0) return 'active' as const
        return this.create(tx, input)
      })
    } catch (error) {
      this.logFailure(input, error)
      return null
    }
  }

  private create(
    db: Pick<Prisma.TransactionClient, 'documentExport'>,
    input: RegisterExportInput,
  ): Promise<ExportRecord> {
    return db.documentExport.create({
      data: {
        shortId: readableCode(),
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
  }

  private logFailure(input: RegisterExportInput, error: unknown): void {
    this.logger.error(
      `Не удалось записать выгрузку ${input.context.kind}/${input.format} в журнал: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
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
  async revokeByDocumentNumber(
    documentNumber: string,
    kind = 'certificate',
    // Транзакция вызывающего: отзыв в журнале и отметка на документе студента — одна операция.
    db: Pick<Prisma.TransactionClient, 'documentExport'> = this.prisma,
  ): Promise<number> {
    const { count } = await db.documentExport.updateMany({
      where: { documentNumber, kind, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    return count
  }

  /** Есть ли действующий (не отозванный) документ с этим номером. */
  async hasActiveDocument(documentNumber: string, kind = 'certificate'): Promise<boolean> {
    const count = await this.prisma.documentExport.count({
      where: { documentNumber, kind, revokedAt: null },
    })
    return count > 0
  }

  /**
   * Отозвать одну запись по коду. Нужен, когда выдача сорвалась после регистрации: код
   * уже существует, а документа под ним нет — страница проверки не должна его подтверждать.
   */
  async revokeByShortId(shortId: string): Promise<void> {
    await this.prisma.documentExport.updateMany({
      where: { shortId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
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
   * по их коду ответ тот же, что по несуществующему, — null (VERIFIABLE_EXPORT_KINDS).
   */
  async findByShortId(shortId: string): Promise<VerifiedExport | null> {
    const found = await this.prisma.documentExport.findFirst({
      where: { shortId, kind: { in: [...VERIFIABLE_EXPORT_KINDS] } },
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
 * Свободный текст в фильтрах выгрузки. Поиск по списку пользователей — это чужие email и
 * ФИО, а журнал выгрузок хранится бессрочно (по нему проверяют справки годами): сам текст
 * в журнал не идёт, только факт, что фильтр был. На листе «Инфо» внутри файла он остаётся —
 * файл и так содержит найденных людей.
 */
const FREE_TEXT_PARAMS = new Set(['search', 'q'])
export const FREE_TEXT_MARK = '[задан]'

/**
 * Параметры выборки для журнала: пустые значения выбрасываем, чтобы в записи не оседали
 * `{"search": null, "role": null}` — по такому фильтру ничего не восстановить, а место и
 * внимание он занимает. Свободный текст заменяется пометкой (FREE_TEXT_PARAMS).
 */
function cleanParams(
  params: Record<string, unknown> | undefined,
): Prisma.InputJsonObject | undefined {
  if (!params) return undefined
  // Значения приводим к строкам: в журнал идут условия выборки, а не произвольный JSON,
  // и строковое представление разбирается глазами без догадок о типе.
  const entries = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(
      ([key, value]) => [key, FREE_TEXT_PARAMS.has(key) ? FREE_TEXT_MARK : String(value)] as const,
    )
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
