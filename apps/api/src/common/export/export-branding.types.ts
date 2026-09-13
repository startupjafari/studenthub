// Типы единого брендирования выгружаемых файлов (план «Брендирование экспорта», этап A1).
//
// Всё, что пользователь скачивает из StudentHub, обязано нести происхождение: открыв файл
// вне системы, человек и программа должны понять, что он выгружен отсюда, когда и кем.
// Здесь — общий словарь понятий; рендер каждого формата живёт у своего генератора.

/** Язык документа. Совпадает с языками интерфейса (apps/web/messages). */
export type ExportLocale = 'ru' | 'kk' | 'en'

/**
 * Вид выгрузки. Значение попадает в имя файла и в метаданные, поэтому список закрыт:
 * новый вид добавляется вместе с подписью на трёх языках, а не строкой на месте вызова.
 */
export type ExportKind = 'resume' | 'users' | 'chat' | 'certificate'

/** Расширение выгружаемого файла — оно же ключ к Content-Type. */
export type ExportFormat = 'pdf' | 'xlsx' | 'csv' | 'txt' | 'json'

export interface ExportActor {
  id: string
  /** ФИО для видимой шапки документа. В метаданные файла НЕ попадает (§ПД в плане). */
  fullName: string
}

/**
 * Контекст одной выгрузки: кто, что, когда и на каком языке.
 *
 * `timezone` — таймзона ВУЗА (`University.timezone`), а не сервера и не пользователя:
 * дата в имени файла и в шапке должна совпадать с тем, как её понимает деканат.
 */
export interface ExportContext {
  kind: ExportKind
  actor: ExportActor
  locale: ExportLocale
  timezone: string
  generatedAt: Date
  /** Фильтры отчёта — для журнала экспортов и листа «Инфо». В метаданные файла не идут. */
  params?: Record<string, unknown>
  /**
   * Короткий код записи в журнале выгрузок. Появляется ПОСЛЕ регистрации и нужен
   * официальным документам: он печатается в колонтитуле и по нему документ проверяют.
   * У рабочих выгрузок остаётся пустым — проверять там нечего.
   */
  shortId?: string
}

/** Метаданные PDF — ложатся в свойства документа (`<Document>` у @react-pdf/renderer). */
export interface PdfMetadata {
  title: string
  author: string
  subject: string
  keywords: string
  creator: string
  producer: string
  creationDate: Date
}

/** Метаданные книги XLSX — `workbook.Props` у SheetJS. */
export interface SheetMetadata {
  Title: string
  Author: string
  LastAuthor: string
  Company: string
  Subject: string
  Keywords: string
  Category: string
  CreatedDate: Date
}

/**
 * Готовый комплект брендирования для PDF: свойства документа, знак, строка происхождения
 * и колонтитул. Собирается один раз на выгрузку и уходит в генератор формата — так
 * генератор не знает ни про конфигурацию, ни про словарь, а только рисует переданное.
 */
export interface PdfBranding {
  metadata: PdfMetadata
  /** Знак как `data:image/png;base64,…`. `null` — отрисовать не удалось, шапка без знака. */
  logo: string | null
  /** «Сформировано 13.09.2026, 02:30 (Asia/Almaty) · Пользователь: Асанов Асан». */
  generatedLine: string
  /** Колонтитул страницы: номер ивсего приходят от рендера, который один знает разбивку. */
  footerLine: (page: number, total: number) => string
}
