import type { ExportKind, ExportLocale } from './export-branding.types'

// Подписи брендирования на трёх языках. Хардкод русского в генераторах запрещён
// (BACKEND_RULES §18, FRONTEND_RULES §15) — но i18n-слоя на бэкенде нет вовсе, а тащить
// `nestjs-i18n` ради десяти строк дороже, чем держать их здесь: подписи одни и те же у
// всех выгрузок и меняются раз в год.
//
// ВНИМАНИЕ: казахские и русские формулировки должны быть вычитаны носителем перед
// выпуском официальных документов — здесь рабочий перевод, а не утверждённый.
//
// Дублирование с apps/web/messages/*.json осознанное: там подписи интерфейса, здесь —
// подписи внутри файла. Совпадать обязаны только названия видов выгрузки.

export interface ExportLabels {
  /** «Сформировано» — начало строки происхождения в шапке документа. */
  generated: string
  /** «Пользователь» — кто выгрузил. */
  user: string
  /** «Система». */
  system: string
  /** «Отчёт» — какой именно вид выгрузки на листе «Инфо». */
  report: string
  /** «Версия» — версия платформы, которой сделана выгрузка. */
  version: string
  /** «Дата выгрузки». */
  exportedAt: string
  /** «Фильтры» — какие условия применялись к отчёту. */
  filters: string
  /** «Идентификатор документа» — короткий ID из журнала экспортов (этап A6). */
  documentId: string
  /** Лист книги с данными. Машиночитаемый лист, таблица с первой строки. */
  dataSheet: string
  /** Лист книги с происхождением выгрузки. */
  infoSheet: string
  /** Шаблон нумерации страниц: `{page}` и `{total}`. */
  pageOf: string
  /** Названия видов выгрузки — идут в заголовок документа и в метаданные. */
  kind: Record<ExportKind, string>
}

const RU: ExportLabels = {
  generated: 'Сформировано',
  user: 'Пользователь',
  system: 'Система',
  report: 'Отчёт',
  version: 'Версия',
  exportedAt: 'Дата выгрузки',
  filters: 'Фильтры',
  documentId: 'Идентификатор документа',
  dataSheet: 'Данные',
  infoSheet: 'Инфо',
  pageOf: 'стр. {page} из {total}',
  kind: {
    resume: 'Резюме',
    certificate: 'Справка об обучении',
    users: 'Список пользователей',
    chat: 'Экспорт переписки',
  },
}

const KK: ExportLabels = {
  generated: 'Қалыптастырылды',
  user: 'Пайдаланушы',
  system: 'Жүйе',
  report: 'Есеп',
  version: 'Нұсқа',
  exportedAt: 'Экспорттау күні',
  filters: 'Сүзгілер',
  documentId: 'Құжат идентификаторы',
  dataSheet: 'Деректер',
  infoSheet: 'Ақпарат',
  // Не «{page}-бет»: числительное в казахском требует согласования, а шаблон подставляет
  // произвольное число. Форма «страница / всего» читается однозначно при любом значении.
  pageOf: '{page} / {total} бет',
  kind: {
    resume: 'Түйіндеме',
    certificate: 'Оқу туралы анықтама',
    users: 'Пайдаланушылар тізімі',
    chat: 'Хат алмасу экспорты',
  },
}

const EN: ExportLabels = {
  generated: 'Generated',
  user: 'User',
  system: 'System',
  report: 'Report',
  version: 'Version',
  exportedAt: 'Export date',
  filters: 'Filters',
  documentId: 'Document ID',
  dataSheet: 'Data',
  infoSheet: 'Info',
  pageOf: 'page {page} of {total}',
  kind: {
    resume: 'Resume',
    certificate: 'Certificate of enrolment',
    users: 'User list',
    chat: 'Chat export',
  },
}

const LABELS: Record<ExportLocale, ExportLabels> = { ru: RU, kk: KK, en: EN }

/** Язык интерфейса → язык документа. Неизвестное значение — русский (основной язык). */
export function exportLabels(locale: ExportLocale): ExportLabels {
  return LABELS[locale] ?? RU
}

/** Список поддерживаемых языков — для валидации `?locale=` и для тестов на полноту. */
export const EXPORT_LOCALES: ExportLocale[] = ['ru', 'kk', 'en']

/** Тег локали для `Intl`: форматы даты и времени берутся у неё, а не собираются вручную. */
export const INTL_TAG: Record<ExportLocale, string> = {
  ru: 'ru-RU',
  kk: 'kk-KZ',
  en: 'en-US',
}
