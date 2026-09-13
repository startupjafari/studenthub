import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { EnvVars } from '../../config/env.schema'
import { pickWebBase } from '../../config/web-base'
import { brandLogoPng } from '../brand/brand-logo'
import { attachmentHeader } from '../http/content-disposition'
import { appVersion, buildSha } from './app-version'
import { EXPORT_LOCALES, INTL_TAG, exportLabels, type ExportLabels } from './export-labels'
import type {
  ExportContext,
  ExportFormat,
  ExportLocale,
  PdfBranding,
  PdfMetadata,
  SheetMetadata,
} from './export-branding.types'

/** Content-Type по расширению: один справочник вместо строки в каждом контроллере. */
const CONTENT_TYPE: Record<ExportFormat, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  json: 'application/json; charset=utf-8',
}

/**
 * Единая точка правды по брендированию выгружаемых файлов (план «Брендирование экспорта»).
 *
 * Сервис ничего не рисует: он отдаёт имена, заголовки, метаданные и готовые строки, а
 * рендер остаётся у генератора формата (@react-pdf для PDF, SheetJS для книг). Иначе общий
 * слой утащил бы за собой ESM-обёртку @react-pdf и зависимости всех форматов сразу.
 *
 * Название платформы, публичный адрес и версия берутся из конфигурации — константы в
 * контроллерах и шаблонах запрещены планом: домен у проекта временный и переезд не должен
 * превращаться в правку двадцати файлов.
 */
@Injectable()
export class ExportBrandingService {
  constructor(private readonly config: ConfigService<EnvVars, true>) {}

  /** Название платформы для шапок, подвалов и метаданных. */
  get brand(): string {
    return this.config.get('BRAND_NAME', { infer: true })
  }

  /**
   * Публичный адрес веба без хвостового слэша. Отдельная переменная, а не первый origin
   * `CORS_ORIGIN`: адрес уходит внутрь выданных документов и обязан переживать смену
   * настроек CORS. Не задана — падаем обратно на CORS_ORIGIN, чтобы dev работал из коробки.
   */
  get publicUrl(): string {
    const explicit = this.config.get('APP_PUBLIC_URL', { infer: true })
    const raw = explicit ?? pickWebBase(this.config.get('CORS_ORIGIN', { infer: true }))
    return raw.replace(/\/+$/, '')
  }

  /** Домен без схемы — для колонтитула, где «https://» только шумит. */
  get domain(): string {
    try {
      return new URL(this.publicUrl).host
    } catch {
      return this.publicUrl.replace(/^https?:\/\//, '')
    }
  }

  /** Версия приложения из package.json (см. app-version.ts). */
  get version(): string {
    return appVersion()
  }

  labels(locale: ExportLocale): ExportLabels {
    return exportLabels(locale)
  }

  /** `?locale=` из запроса → язык документа. Мусор и отсутствие — русский. */
  resolveLocale(raw: string | undefined): ExportLocale {
    const value = raw?.trim().toLowerCase()
    return EXPORT_LOCALES.find((locale) => locale === value) ?? 'ru'
  }

  /**
   * Имя файла: `studenthub_users_2026-09-12.xlsx`.
   *
   * Латиница, нижний регистр, без пробелов — имя переживает любую файловую систему и
   * почтовый клиент. Дата берётся в таймзоне ВУЗА: сервер живёт в UTC, и без этого
   * вечерняя выгрузка в Алматы получала бы вчерашнее число.
   */
  filename(ctx: ExportContext, format: ExportFormat): string {
    return `${this.brandSlug()}_${ctx.kind}_${this.isoDate(ctx)}.${format}`
  }

  /** Значение `Content-Disposition` с обеими формами имени (RFC 5987). */
  disposition(filename: string): string {
    return attachmentHeader(filename)
  }

  contentType(format: ExportFormat): string {
    return CONTENT_TYPE[format]
  }

  /**
   * Свойства PDF-документа.
   *
   * Персональных данных здесь нет намеренно: метаданные переживают пересылку файла и не
   * видны при беглом просмотре, поэтому ФИО получателя живёт только в видимой шапке.
   * `author` — платформа, а не человек: автор документа именно она.
   */
  pdfMetadata(ctx: ExportContext): PdfMetadata {
    const labels = this.labels(ctx.locale)
    return {
      title: `${labels.kind[ctx.kind]} — ${this.brand}`,
      author: this.brand,
      subject: `${labels.exportedAt}: ${this.dateTime(ctx)}`,
      keywords: this.keywords(ctx),
      creator: `${this.brand} v${this.version}`,
      producer: `${this.brand} — ${this.domain}`,
      creationDate: ctx.generatedAt,
    }
  }

  /**
   * Всё брендирование PDF одним вызовом: свойства документа, знак растром, строка
   * происхождения и колонтитул. Знак кешируется внутри `brandLogoPng`, так что вызов
   * дешёвый и на сотой выгрузке.
   *
   * `logoSizePx` — сторона растра, не размер на странице: в PDF знак ставится в пунктах,
   * и растр берём кратно крупнее, иначе на печати он мылится.
   */
  async pdfBranding(ctx: ExportContext, logoSizePx = 96): Promise<PdfBranding> {
    const png = await brandLogoPng(logoSizePx)
    return {
      metadata: this.pdfMetadata(ctx),
      logo: png ? `data:image/png;base64,${png.toString('base64')}` : null,
      generatedLine: this.generatedLine(ctx),
      footerLine: (page, total) => this.footerLine(ctx, page, total),
    }
  }

  /** Свойства книги XLSX (`workbook.Props` SheetJS). */
  sheetMetadata(ctx: ExportContext): SheetMetadata {
    const labels = this.labels(ctx.locale)
    return {
      Title: `${labels.kind[ctx.kind]} — ${this.brand}`,
      Author: this.brand,
      LastAuthor: this.brand,
      Company: this.brand,
      Subject: `${labels.exportedAt}: ${this.dateTime(ctx)}`,
      Keywords: this.keywords(ctx),
      Category: labels.kind[ctx.kind],
      CreatedDate: ctx.generatedAt,
    }
  }

  /**
   * Строка происхождения для видимой шапки первой страницы:
   * «Сформировано 12.09.2026, 14:30 (Asia/Almaty) · Пользователь: Асанов Асан».
   *
   * Разделитель, а не запятая с продолжением фразы: подписи приходят из словаря с
   * заглавной буквы, и склеивать их в предложение значило бы понижать регистр — приём,
   * который ломается на первом же языке с другими правилами.
   */
  generatedLine(ctx: ExportContext): string {
    const labels = this.labels(ctx.locale)
    return `${labels.generated} ${this.dateTime(ctx)} · ${labels.user}: ${ctx.actor.fullName}`
  }

  /**
   * Происхождение выгрузки строками «подпись → значение» — для листа «Инфо» в книге и
   * для любого другого места, где брендирование не помещается в одну строку.
   *
   * Фильтры отчёта попадают сюда, а не в метаданные файла: человек, открывший книгу через
   * месяц, должен видеть, по какой выборке она собрана, — иначе цифры не с чем сверить.
   */
  infoRows(ctx: ExportContext): Array<[label: string, value: string]> {
    const labels = this.labels(ctx.locale)
    const rows: Array<[string, string]> = [
      [labels.system, `${this.brand} — ${this.domain}`],
      [labels.report, labels.kind[ctx.kind]],
      [labels.exportedAt, this.dateTime(ctx)],
      [labels.user, ctx.actor.fullName],
      [labels.version, `v${this.version}`],
    ]
    const filters = formatFilters(ctx.params)
    if (filters) rows.push([labels.filters, filters])
    return rows
  }

  /**
   * То же происхождение, но машинными ключами и в ISO — для JSON-выгрузок и журналов.
   *
   * Отдельно от `infoRows`: там подписи на языке выгрузки, и ключ «Дата выгрузки» в
   * JSON означал бы, что разбирающая сторона обязана знать, на каком языке файл
   * скачали. Ключи здесь не переводятся никогда.
   */
  provenance(ctx: ExportContext): Record<string, string> {
    return {
      system: this.brand,
      url: this.publicUrl,
      report: ctx.kind,
      exportedAt: ctx.generatedAt.toISOString(),
      timezone: ctx.timezone,
      exportedBy: ctx.actor.fullName,
      version: this.version,
    }
  }

  /** Колонтитул: «StudentHub · studenthub.kz · стр. 1 из 3». */
  footerLine(ctx: ExportContext, page: number, total: number): string {
    const pages = this.labels(ctx.locale)
      .pageOf.replace('{page}', String(page))
      .replace('{total}', String(total))
    return `${this.brand} · ${this.domain} · ${pages}`
  }

  /** Дата и время выгрузки с явной таймзоной — в ней же считается дата в имени файла. */
  dateTime(ctx: ExportContext): string {
    const formatted = new Intl.DateTimeFormat(INTL_TAG[ctx.locale], {
      timeZone: ctx.timezone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(ctx.generatedAt)
    // Таймзона печатается рядом со временем: справка живёт вне системы, и «14:30» без
    // пояснения — это время неизвестно где.
    return `${formatted} (${ctx.timezone})`
  }

  /** `YYYY-MM-DD` в таймзоне вуза: `en-CA` даёт ровно этот порядок без ручной сборки. */
  private isoDate(ctx: ExportContext): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: ctx.timezone }).format(ctx.generatedAt)
  }

  /**
   * Ключевые слова: платформа, признак выгрузки, вид отчёта и — если платформа его дала —
   * SHA сборки. Версия в package.json меняется руками, и по ней одной нельзя понять, какой
   * сборкой выпущен документ.
   */
  private keywords(ctx: ExportContext): string {
    const sha = buildSha()
    return [this.brand, 'export', this.labels(ctx.locale).kind[ctx.kind], sha]
      .filter(Boolean)
      .join(', ')
  }

  /** Название платформы в имени файла: только латиница и цифры, иначе — `export`. */
  private brandSlug(): string {
    const slug = this.brand.toLowerCase().replace(/[^a-z0-9]+/g, '')
    return slug || 'export'
  }
}

/**
 * Фильтры отчёта одной строкой: `роль=STUDENT · поиск=иван`. Пустые значения выбрасываем —
 * строка «поиск=» ничего не сообщает, а место занимает.
 */
function formatFilters(params: Record<string, unknown> | undefined): string | null {
  if (!params) return null
  const parts = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${String(value)}`)
  return parts.length > 0 ? parts.join(' · ') : null
}
