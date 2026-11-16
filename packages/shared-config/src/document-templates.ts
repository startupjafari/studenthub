// DOCX-шаблоны документов вуза (docs/PROJECT.md §3.8 «Шаблоны документов»).
//
// Реестр переменных — единственный источник истины для API и веба: сервер разрешает в шаблоне
// ТОЛЬКО ключи отсюда и подставляет значения по ним, веб строит из него каталог для
// сотрудника. Ключ, которого здесь нет, шаблон не пройдёт проверку — так в документ не
// попадёт ни служебное поле, ни что-то, чего у платформы на самом деле нет.
//
// В реестр входят только поля, которые реально хранятся в StudentHub (User, Group, Faculty,
// University). ИИН, БИН, ректора и номера документа в модели данных нет — значит, нет и
// переменных: показать их доступными означало бы обещать вузу пустые места в справках.
//
// Подписи и описания переменных — в словарях веба (`DocumentTemplates.var_<ключ>_*`), здесь
// только то, что нужно обеим сторонам. `example` — синтетическое значение: им заполняется
// проверочный документ, и его же каталог показывает как пример. Реальных людей в примерах нет.

export const DOCUMENT_TEMPLATE_VARIABLE_GROUPS = [
  'STUDENT',
  'EDUCATION',
  'UNIVERSITY',
  'DOCUMENT',
  'ISSUER',
] as const
export type DocumentTemplateVariableGroup = (typeof DOCUMENT_TEMPLATE_VARIABLE_GROUPS)[number]

export interface DocumentTemplateVariableDef {
  /** Техническое имя: в DOCX пишется как `{student.fullName}`. */
  key: string
  group: DocumentTemplateVariableGroup
  /** Синтетический пример — для каталога и проверочной генерации. */
  example: string
  /**
   * Поле законно бывает пустым (отчества нет у многих), поэтому пустое значение не мешает
   * сформировать документ. У остальных пустое значение — отказ генерации (§9 ТЗ).
   */
  optional?: boolean
  /** Персональные данные: каталог помечает их, чтобы сотрудник ставил их осознанно. */
  personal?: boolean
}

export const DOCUMENT_TEMPLATE_VARIABLES = [
  // Студент
  {
    key: 'student.fullName',
    group: 'STUDENT',
    example: 'Нурланова Айгерим Ержановна',
    personal: true,
  },
  { key: 'student.lastName', group: 'STUDENT', example: 'Нурланова', personal: true },
  { key: 'student.firstName', group: 'STUDENT', example: 'Айгерим', personal: true },
  {
    key: 'student.middleName',
    group: 'STUDENT',
    example: 'Ержановна',
    optional: true,
    personal: true,
  },
  { key: 'student.birthDate', group: 'STUDENT', example: '14.03.2005', personal: true },
  { key: 'student.studentCardNumber', group: 'STUDENT', example: '202312345', personal: true },

  // Обучение
  { key: 'student.group', group: 'EDUCATION', example: 'ИС-23' },
  { key: 'student.course', group: 'EDUCATION', example: '3' },
  { key: 'student.faculty', group: 'EDUCATION', example: 'Факультет информационных технологий' },
  { key: 'student.specialty', group: 'EDUCATION', example: '6B06102 Информационные системы' },
  { key: 'student.studyForm', group: 'EDUCATION', example: 'Очная' },
  { key: 'student.educationLevel', group: 'EDUCATION', example: 'Бакалавриат' },
  { key: 'student.fundingType', group: 'EDUCATION', example: 'Грант' },
  { key: 'student.enrollmentYear', group: 'EDUCATION', example: '2023' },
  { key: 'student.graduationYear', group: 'EDUCATION', example: '2027' },

  // Университет
  { key: 'university.name', group: 'UNIVERSITY', example: 'Пример университета' },
  { key: 'university.shortName', group: 'UNIVERSITY', example: 'ПУ' },
  { key: 'university.city', group: 'UNIVERSITY', example: 'Астана' },
  { key: 'university.address', group: 'UNIVERSITY', example: 'пр. Примерный, 1' },
  { key: 'university.phone', group: 'UNIVERSITY', example: '+7 700 000 00 00' },
  { key: 'university.email', group: 'UNIVERSITY', example: 'info@example.edu' },
  { key: 'university.website', group: 'UNIVERSITY', example: 'https://example.edu' },

  // Документ
  { key: 'document.date', group: 'DOCUMENT', example: '06.11.2026' },
  { key: 'document.year', group: 'DOCUMENT', example: '2026' },

  // Кто формирует документ
  { key: 'issuer.fullName', group: 'ISSUER', example: 'Примерова Мария Сергеевна' },
  { key: 'issuer.position', group: 'ISSUER', example: 'Специалист офиса регистратора' },
] as const satisfies readonly DocumentTemplateVariableDef[]

export type DocumentTemplateVariableKey = (typeof DOCUMENT_TEMPLATE_VARIABLES)[number]['key']

/** Определение переменной по ключу; `undefined` — ключ не из реестра. */
export function documentTemplateVariable(key: string): DocumentTemplateVariableDef | undefined {
  return (DOCUMENT_TEMPLATE_VARIABLES as readonly DocumentTemplateVariableDef[]).find(
    (v) => v.key === key,
  )
}

/** Языки документа: на нём подставляются значения-коды (форма обучения, финансирование). */
export const DOCUMENT_TEMPLATE_LOCALES = ['ru', 'kk', 'en'] as const
export type DocumentTemplateLocale = (typeof DOCUMENT_TEMPLATE_LOCALES)[number]

/**
 * Подписи учебных кодов. Поле в профиле бывает и кодом (`FULL_TIME` — так пишут импорт и
 * сид), и готовым словом («Очная» — так его заполняет форма веба). Код переводим, слово
 * подставляем как есть. Подписи совпадают со студенческим билетом в вебе.
 */
export const DOCUMENT_TEMPLATE_CODE_LABELS: Record<
  DocumentTemplateLocale,
  Record<string, string>
> = {
  ru: {
    BACHELOR: 'Бакалавриат',
    MASTER: 'Магистратура',
    PHD: 'Докторантура (PhD)',
    FULL_TIME: 'Очная',
    PART_TIME: 'Заочная',
    DISTANCE: 'Дистанционная',
    GRANT: 'Грант',
    PAID: 'Платное',
    QUOTA: 'Квота',
  },
  kk: {
    BACHELOR: 'Бакалавриат',
    MASTER: 'Магистратура',
    PHD: 'Докторантура (PhD)',
    FULL_TIME: 'Күндізгі',
    PART_TIME: 'Сырттай',
    DISTANCE: 'Қашықтықтан',
    GRANT: 'Грант',
    PAID: 'Ақылы',
    QUOTA: 'Квота',
  },
  en: {
    BACHELOR: "Bachelor's",
    MASTER: "Master's",
    PHD: 'PhD',
    FULL_TIME: 'Full-time',
    PART_TIME: 'Part-time',
    DISTANCE: 'Distance',
    GRANT: 'Grant',
    PAID: 'Paid',
    QUOTA: 'Quota',
  },
}

/**
 * Пределы загрузки и разбора DOCX.
 *
 * `MAX_BYTES_DEFAULT` — предел по умолчанию; на сервере его переопределяет env
 * `DOCUMENT_TEMPLATE_MAX_BYTES`, но не выше `MAX_BYTES_CEILING`: шаблон идёт буферной
 * загрузкой через API-процесс, а её порог — 10 МБ (FILE_UPLOAD.DIRECT_UPLOAD_THRESHOLD_BYTES).
 *
 * Остальное — защита от zip-бомб: DOCX — это zip, и 5 МБ архива могут развернуться в
 * гигабайты. Распакованный объём, число частей и степень сжатия проверяются ДО разбора.
 */
export const DOCUMENT_TEMPLATE_LIMITS = {
  MAX_BYTES_DEFAULT: 5 * 1024 * 1024,
  MAX_BYTES_CEILING: 10 * 1024 * 1024,
  MAX_ZIP_ENTRIES: 1000,
  MAX_UNCOMPRESSED_BYTES: 60 * 1024 * 1024,
  /** Степень сжатия одной части. Обычный XML Word сжимается в 5–20 раз. */
  MAX_COMPRESSION_RATIO: 200,
  /** Переменных в одном шаблоне. Справка — это десятки, а не тысячи подстановок. */
  MAX_TAGS: 500,
  /**
   * Замечаний в отчёте проверки. Отчёт хранится в версии и уходит в карточку шаблона:
   * документ с тысячами неизвестных тегов раздул бы его до мегабайтов, а сотруднику хватит
   * первых — остальные обычно той же природы.
   */
  MAX_REPORTED_ISSUES: 50,
} as const
