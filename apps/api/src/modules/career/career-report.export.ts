import type { ExportLocale } from '../../common/export/export-branding.types'
import type { SpreadsheetColumn } from '../../common/export/spreadsheet.builder'

/**
 * Раскладка отчёта карьерного центра в таблицу.
 *
 * Формат «раздел · показатель · значение · справочно», а не широкая матрица: в отчёте
 * рядом стоят величины разной природы — часы, доли, штуки, названия факультетов. Свести
 * их в одну строку значило бы либо выкинуть половину, либо получить таблицу с тремя
 * десятками пустых клеток. Длинная таблица переживает и Excel, и импорт.
 */

export interface ReportRow {
  section: string
  name: string
  value: string | number | null
  /** Контекст значения: прошлый период, знаменатель, доля. */
  note: string
}

interface Labels {
  section: string
  metric: string
  value: string
  note: string
  sections: {
    volume: string
    speed: string
    funnel: string
    outcomes: string
    students: string
    market: string
    faculties: string
    companies: string
  }
  metrics: Record<string, string>
  previous: string
  of: string
}

const RU: Labels = {
  section: 'Раздел',
  metric: 'Показатель',
  value: 'Значение',
  note: 'Справочно',
  sections: {
    volume: 'Объём',
    speed: 'Скорость',
    funnel: 'Воронка',
    outcomes: 'Исходы',
    students: 'Студенты',
    market: 'Витрина',
    faculties: 'Факультеты',
    companies: 'Компании',
  },
  metrics: {
    applications: 'Откликов',
    hired: 'Трудоустроено',
    vacancies: 'Новых вакансий',
    companies: 'Допущено компаний',
    firstResponse: 'Медиана до первого ответа, ч',
    hireDays: 'Медиана до найма, дн.',
    silent: 'Откликов без ответа',
    SUBMITTED: 'Отправлено',
    VIEWED: 'Просмотрено',
    SHORTLISTED: 'В подборке',
    INTERVIEW: 'Интервью',
    OFFER: 'Оффер',
    HIRED: 'Найм',
    rejected: 'Отказы',
    withdrawn: 'Отозвано студентом',
    active: 'В работе',
    profiles: 'Открытых профилей',
    resumes: 'Резюме опубликовано',
    graduates: 'Выпускников в этом году',
    graduatesHired: 'Из них трудоустроено',
    shown: 'Вакансий показывается',
    dead: 'Вакансий без откликов',
    offered: 'Медиана предлагаемой вилки',
    desired: 'Медиана ожиданий студентов',
  },
  previous: 'прошлый период',
  of: 'из',
}

const KK: Labels = {
  section: 'Бөлім',
  metric: 'Көрсеткіш',
  value: 'Мән',
  note: 'Анықтама',
  sections: {
    volume: 'Көлем',
    speed: 'Жылдамдық',
    funnel: 'Шұңғыма',
    outcomes: 'Нәтижелер',
    students: 'Студенттер',
    market: 'Витрина',
    faculties: 'Факультеттер',
    companies: 'Компаниялар',
  },
  metrics: {
    applications: 'Өтінімдер',
    hired: 'Жұмысқа алынды',
    vacancies: 'Жаңа вакансиялар',
    companies: 'Рұқсат берілген компаниялар',
    firstResponse: 'Алғашқы жауапқа дейінгі медиана, сағ',
    hireDays: 'Жұмысқа алуға дейінгі медиана, күн',
    silent: 'Жауапсыз өтінімдер',
    SUBMITTED: 'Жіберілді',
    VIEWED: 'Қаралды',
    SHORTLISTED: 'Іріктеуде',
    INTERVIEW: 'Сұхбат',
    OFFER: 'Оффер',
    HIRED: 'Жұмысқа алу',
    rejected: 'Бас тартулар',
    withdrawn: 'Студент кері қайтарған',
    active: 'Жұмыста',
    profiles: 'Ашық профильдер',
    resumes: 'Жарияланған түйіндемелер',
    graduates: 'Биылғы бітірушілер',
    graduatesHired: 'Оның ішінде жұмысқа орналасқан',
    shown: 'Көрсетілетін вакансиялар',
    dead: 'Өтінімсіз вакансиялар',
    offered: 'Ұсынылатын жалақы медианасы',
    desired: 'Студенттер күтуінің медианасы',
  },
  previous: 'өткен кезең',
  of: '/',
}

const EN: Labels = {
  section: 'Section',
  metric: 'Metric',
  value: 'Value',
  note: 'Note',
  sections: {
    volume: 'Volume',
    speed: 'Speed',
    funnel: 'Funnel',
    outcomes: 'Outcomes',
    students: 'Students',
    market: 'Marketplace',
    faculties: 'Faculties',
    companies: 'Companies',
  },
  metrics: {
    applications: 'Applications',
    hired: 'Hired',
    vacancies: 'New vacancies',
    companies: 'Companies approved',
    firstResponse: 'Median time to first response, h',
    hireDays: 'Median time to hire, days',
    silent: 'Applications with no response',
    SUBMITTED: 'Submitted',
    VIEWED: 'Viewed',
    SHORTLISTED: 'Shortlisted',
    INTERVIEW: 'Interview',
    OFFER: 'Offer',
    HIRED: 'Hired',
    rejected: 'Rejected',
    withdrawn: 'Withdrawn by student',
    active: 'In progress',
    profiles: 'Open profiles',
    resumes: 'Published resumes',
    graduates: 'Graduating this year',
    graduatesHired: 'Of them hired',
    shown: 'Vacancies shown',
    dead: 'Vacancies without applications',
    offered: 'Median offered range',
    desired: 'Median expected range',
  },
  previous: 'previous period',
  of: 'of',
}

const LABELS: Record<ExportLocale, Labels> = { ru: RU, kk: KK, en: EN }

export function reportColumns(locale: ExportLocale): SpreadsheetColumn<ReportRow>[] {
  const l = LABELS[locale] ?? RU
  return [
    { header: l.section, value: (r) => r.section, width: 16 },
    { header: l.metric, value: (r) => r.name, width: 36 },
    { header: l.value, value: (r) => r.value, width: 14 },
    { header: l.note, value: (r) => r.note, width: 28 },
  ]
}

type Report = {
  totals: Record<string, { value: number; previous: number }>
  timing: {
    firstResponseHours: number | null
    hireDays: number | null
    silent: number
    silentShare: number | null
  }
  funnel: { stages: Record<string, number> }
  outcomes: { hired: number; rejected: number; withdrawn: number; active: number; total: number }
  students: {
    profiles: { visible: number; total: number; share: number | null }
    resumesPublished: number
  }
  graduates: { year: number; students: number; hired: number; share: number | null }
  deadVacancies: { dead: number; shown: number }
  salary: {
    offeredMin: number | null
    offeredMax: number | null
    desiredMin: number | null
    desiredMax: number | null
  }
  faculties: {
    items: Array<{
      name: string
      students: number
      applied: number
      hired: number
      hiredShare: number | null
    }>
  }
  companies: Array<{ name: string; applications: number; hired: number }>
}

/** Отчёт → строки таблицы. Порядок разделов такой же, как на экране метрик. */
export function reportRows(report: Report, locale: ExportLocale): ReportRow[] {
  const l = LABELS[locale] ?? RU
  const m = l.metrics
  const s = l.sections
  const rows: ReportRow[] = []
  const push = (section: string, name: string, value: string | number | null, note = ''): void => {
    rows.push({ section, name, value, note })
  }
  const delta = (d: { value: number; previous: number }) => `${l.previous}: ${d.previous}`

  for (const key of ['applications', 'hired', 'vacancies', 'companies'] as const) {
    const item = report.totals[key]
    if (item) push(s.volume, m[key] ?? key, item.value, delta(item))
  }

  push(s.speed, m.firstResponse ?? '', report.timing.firstResponseHours)
  push(s.speed, m.hireDays ?? '', report.timing.hireDays)
  push(
    s.speed,
    m.silent ?? '',
    report.timing.silent,
    report.timing.silentShare === null ? '' : `${report.timing.silentShare}%`,
  )

  for (const [key, value] of Object.entries(report.funnel.stages)) {
    push(s.funnel, m[key] ?? key, value)
  }

  for (const key of ['hired', 'rejected', 'withdrawn', 'active'] as const) {
    push(s.outcomes, m[key] ?? key, report.outcomes[key])
  }

  push(
    s.students,
    m.profiles ?? '',
    report.students.profiles.visible,
    `${l.of} ${report.students.profiles.total}`,
  )
  push(s.students, m.resumes ?? '', report.students.resumesPublished)
  push(s.students, m.graduates ?? '', report.graduates.students, String(report.graduates.year))
  push(
    s.students,
    m.graduatesHired ?? '',
    report.graduates.hired,
    report.graduates.share === null ? '' : `${report.graduates.share}%`,
  )

  push(s.market, m.shown ?? '', report.deadVacancies.shown)
  push(s.market, m.dead ?? '', report.deadVacancies.dead)
  push(s.market, m.offered ?? '', range(report.salary.offeredMin, report.salary.offeredMax))
  push(s.market, m.desired ?? '', range(report.salary.desiredMin, report.salary.desiredMax))

  for (const f of report.faculties.items) {
    push(
      s.faculties,
      f.name,
      f.hired,
      `${f.applied} / ${f.students}${f.hiredShare === null ? '' : ` · ${f.hiredShare}%`}`,
    )
  }

  for (const c of report.companies) {
    push(s.companies, c.name, c.hired, `${c.applications}`)
  }

  return rows
}

/** Вилка «от — до». Прочерк, когда ни одной вакансии с зарплатой не указано. */
function range(min: number | null, max: number | null): string {
  if (min === null && max === null) return '—'
  return `${min ?? '—'} — ${max ?? '—'}`
}
