import type { ExportLocale } from '../../common/export/export-branding.types'
import type { SpreadsheetColumn } from '../../common/export/spreadsheet.builder'
import type { AnalyticsReport, ReportLevel, ReportMetrics } from './analytics-report.service'

/**
 * Раскладка отчёта по сводке в таблицу.
 *
 * Широкая таблица, а не «раздел · показатель · значение», как у отчёта карьеры: здесь все
 * величины одной природы (штуки и доли по одному и тому же подразделению), и человек
 * сравнивает подразделения между собой — строка на группу или факультет читается сразу,
 * а автофильтр и сортировка Excel работают без сводной таблицы.
 *
 * Последняя строка — «Итого» по области отчёта. Скрытое порогом подразделение остаётся
 * строкой с названием и пометкой, но без чисел: таблица не должна выглядеть полной, когда
 * это не так.
 */

export interface ReportRow {
  name: string
  metrics: ReportMetrics | null
  note: string
}

interface Labels {
  unit: Record<ReportLevel, string>
  students: string
  marks: string
  attendanceRate: string
  absent: string
  late: string
  excused: string
  gradeAvg: string
  gradeCount: string
  examPassed: string
  examFailed: string
  examAbsent: string
  examRetake: string
  applicationsSubmitted: string
  applicationsClosed: string
  applicationsOverdue: string
  submissions: string
  activeStudents: string
  note: string
  total: string
  /** Пометка скрытой строки: `{min}` — порог малых групп. */
  suppressed: string
  /** Пометка итога или строки, посчитанных без скрытых подразделений. */
  partialTotal: string
}

const RU: Labels = {
  unit: { platform: 'Вуз', university: 'Факультет', faculty: 'Группа', teacher: 'Группа' },
  students: 'Студентов',
  marks: 'Отметок посещаемости',
  attendanceRate: 'Посещаемость, %',
  absent: 'Пропусков',
  late: 'Опозданий',
  excused: 'По уважительной причине',
  gradeAvg: 'Средний балл, %',
  gradeCount: 'Оценок выставлено',
  examPassed: 'Экзамен: сдали',
  examFailed: 'Экзамен: не сдали',
  examAbsent: 'Экзамен: неявка',
  examRetake: 'Экзамен: пересдача',
  applicationsSubmitted: 'Заявок поступило',
  applicationsClosed: 'Заявок закрыто',
  applicationsOverdue: 'Закрыто с просрочкой',
  submissions: 'Работ сдано',
  activeStudents: 'Активных студентов',
  note: 'Примечание',
  total: 'Итого',
  suppressed: 'Скрыто: меньше {min} студентов',
  partialTotal: 'Без скрытых подразделений',
}

const KK: Labels = {
  unit: { platform: 'ЖОО', university: 'Факультет', faculty: 'Топ', teacher: 'Топ' },
  students: 'Студенттер',
  marks: 'Қатысу белгілері',
  attendanceRate: 'Қатысу, %',
  absent: 'Келмегендер',
  late: 'Кешігулер',
  excused: 'Дәлелді себеппен',
  gradeAvg: 'Орташа балл, %',
  gradeCount: 'Қойылған бағалар',
  examPassed: 'Емтихан: тапсырды',
  examFailed: 'Емтихан: тапсырмады',
  examAbsent: 'Емтихан: келмеді',
  examRetake: 'Емтихан: қайта тапсыру',
  applicationsSubmitted: 'Түскен өтінімдер',
  applicationsClosed: 'Жабылған өтінімдер',
  applicationsOverdue: 'Мерзімі өтіп жабылды',
  submissions: 'Тапсырылған жұмыстар',
  activeStudents: 'Белсенді студенттер',
  note: 'Ескерту',
  total: 'Барлығы',
  suppressed: 'Жасырылған: {min} студенттен аз',
  partialTotal: 'Жасырылған бөлімшелерсіз',
}

const EN: Labels = {
  unit: { platform: 'University', university: 'Faculty', faculty: 'Group', teacher: 'Group' },
  students: 'Students',
  marks: 'Attendance marks',
  attendanceRate: 'Attendance, %',
  absent: 'Absences',
  late: 'Late arrivals',
  excused: 'Excused',
  gradeAvg: 'Average grade, %',
  gradeCount: 'Grades given',
  examPassed: 'Exam: passed',
  examFailed: 'Exam: failed',
  examAbsent: 'Exam: no-show',
  examRetake: 'Exam: retake',
  applicationsSubmitted: 'Requests submitted',
  applicationsClosed: 'Requests closed',
  applicationsOverdue: 'Closed overdue',
  submissions: 'Assignments submitted',
  activeStudents: 'Active students',
  note: 'Note',
  total: 'Total',
  suppressed: 'Hidden: fewer than {min} students',
  partialTotal: 'Excluding hidden units',
}

const LABELS: Record<ExportLocale, Labels> = { ru: RU, kk: KK, en: EN }

function labelsOf(locale: ExportLocale): Labels {
  return LABELS[locale] ?? RU
}

/** Строки файла: подразделения в порядке отчёта и последней — «Итого». */
export function reportRows(report: AnalyticsReport, locale: ExportLocale): ReportRow[] {
  const l = labelsOf(locale)
  const suppressedNote = l.suppressed.replace('{min}', String(report.minCell))
  const rows: ReportRow[] = report.units.map((unit) => ({
    name: unit.name,
    metrics: unit.metrics,
    // Строка вуза или факультета без своих скрытых групп — иначе разность с отчётом
    // уровнем ниже раскрыла бы их (suppressedGroups).
    note: unit.suppressed ? suppressedNote : unit.partial ? l.partialTotal : '',
  }))
  rows.push({
    name: l.total,
    metrics: report.total?.metrics ?? null,
    note: !report.total ? suppressedNote : report.total.partial ? l.partialTotal : '',
  })
  return rows
}

type Value = string | number | null

/**
 * Колонки по уровню. У преподавателя нет заявок и активности: заявки студент подаёт в
 * деканат, а не преподавателю, и «активный в системе» не говорит ничего о его курсе.
 * Пустая колонка в файле читалась бы как «ноль заявок» — поэтому её нет вовсе.
 */
export function reportColumns(
  level: ReportLevel,
  locale: ExportLocale,
): SpreadsheetColumn<ReportRow>[] {
  const l = labelsOf(locale)
  const m =
    (pick: (metrics: ReportMetrics) => Value) =>
    (row: ReportRow): Value =>
      row.metrics ? pick(row.metrics) : null

  const columns: SpreadsheetColumn<ReportRow>[] = [
    { header: l.unit[level], value: (row) => row.name, width: 32 },
    { header: l.students, value: m((x) => x.students) },
    { header: l.marks, value: m((x) => x.attendance.marks) },
    { header: l.attendanceRate, value: m((x) => x.attendance.rate) },
    { header: l.absent, value: m((x) => x.attendance.absent) },
    { header: l.late, value: m((x) => x.attendance.late) },
    { header: l.excused, value: m((x) => x.attendance.excused) },
    { header: l.gradeAvg, value: m((x) => x.grades.avg) },
    { header: l.gradeCount, value: m((x) => x.grades.count) },
    { header: l.examPassed, value: m((x) => x.exams.passed) },
    { header: l.examFailed, value: m((x) => x.exams.failed) },
    { header: l.examAbsent, value: m((x) => x.exams.absent) },
    { header: l.examRetake, value: m((x) => x.exams.retake) },
  ]
  if (level !== 'teacher') {
    columns.push(
      { header: l.applicationsSubmitted, value: m((x) => x.applications?.submitted ?? null) },
      { header: l.applicationsClosed, value: m((x) => x.applications?.closed ?? null) },
      { header: l.applicationsOverdue, value: m((x) => x.applications?.overdue ?? null) },
    )
  }
  columns.push({ header: l.submissions, value: m((x) => x.submissions) })
  if (level !== 'teacher') {
    columns.push({ header: l.activeStudents, value: m((x) => x.activeStudents) })
  }
  columns.push({ header: l.note, value: (row) => row.note, width: 36 })
  return columns
}
