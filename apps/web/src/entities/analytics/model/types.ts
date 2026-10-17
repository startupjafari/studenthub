export interface FacultyTotals {
  groups: number
  students: number
  attendanceRate: number
  submissionsPending: number
  examsUpcoming: number
}

export interface GroupStat {
  groupId: string
  name: string
  students: number
  attendanceRate: number
  attendanceTracked: number
}

export interface AtRiskGroup {
  groupId: string
  name: string
  attendanceRate: number
}

export interface FacultyOverview {
  facultyId: string
  totals: FacultyTotals
  groups: GroupStat[]
  atRisk: AtRiskGroup[]
}

export interface StudentAttendanceStat {
  studentId: string
  firstName: string
  lastName: string
  attendanceRate: number
  tracked: number
}

export interface GroupAttendance {
  groupId: string
  students: StudentAttendanceStat[]
}

// Early Warning (PR-7): студенты «требует внимания» с явными причинами.
export type RiskReasonKind = 'LOW_ATTENDANCE' | 'OVERDUE_ASSIGNMENTS' | 'LOW_GRADES'
export interface RiskReason {
  kind: RiskReasonKind
  value: number // проценты для LOW_*; штуки для OVERDUE_ASSIGNMENTS
}
export interface AtRiskStudent {
  studentId: string
  firstName: string
  lastName: string
  groupId: string | null
  groupName: string | null
  reasons: RiskReason[]
  severity: number
}
export interface AtRiskStudents {
  facultyId: string
  thresholds: { attendance: number; gradeAvg: number }
  students: AtRiskStudent[]
}

// ── Аналитика платформы (дашборд PLATFORM_ADMIN) ─────────────────────────────
// Формы повторяют ответы GET /analytics/platform/*. Ряды приходят уже с полными
// корзинами (сервер досыпает нули), клиент их не достраивает.

export type PlatformInterval = 'day' | 'week' | 'month'

export interface SeriesPoint {
  /** Начало корзины, ISO. */
  at: string
  value: number
}

export interface MultiSeries {
  interval: PlatformInterval
  from: string
  to: string
  series: { key: string; points: SeriesPoint[] }[]
}

export interface PlatformOverview {
  universities: { active: number; pending: number; blocked: number }
  users: { total: number; spark: number[] }
  complaints: { pending: number; spark: number[] }
  resolutionHours: { median: number | null; previousMedian: number | null }
  activeUsers: { dau: number; wau: number; spark: number[] }
}

export interface UniversitySize {
  id: string
  name: string
  shortName: string | null
  status: string
  /** Код КАТО — имя города резолвит useKatoNames. */
  city: string | null
  /** Студенты вместе со старостами. */
  students: number
  teachers: number
  /** Все пользователи вуза, любой роли. */
  total: number
  faculties: number
  groups: number
  rooms: number
}

/** Итоги по всей платформе — не сумма `items`: сервер отдаёт не больше 200 вузов. */
export interface UniversitiesTotals {
  universities: number
  active: number
  faculties: number
  groups: number
  rooms: number
  students: number
  teachers: number
  total: number
}

export interface UniversitiesSize {
  /** Крупнейшие первыми. */
  items: UniversitySize[]
  totals: UniversitiesTotals
}

export interface ComplaintsLatency {
  from: string
  to: string
  medianHours: number | null
  buckets: { key: string; value: number }[]
}

export interface InvitesFunnel {
  from: string
  to: string
  total: number
  used: number
  /** Доля использованных, проценты. */
  conversion: number
  byStatus: { key: string; value: number }[]
  series: MultiSeries
}

export interface ActivityHeatmap {
  from: string
  to: string
  /** Зона, в которой сервер разложил часы (эхо запроса). */
  tz: string
  /** cells[dow][hour], dow: 0 = понедельник. */
  cells: number[][]
  /**
   * Сколько календарных дат каждого дня недели попало в период — делитель для
   * сравнения будней с выходными: понедельников в окне обычно больше, чем суббот.
   */
  days: number[]
  max: number
}

export interface TopActions {
  from: string
  to: string
  items: { action: string; value: number }[]
}

// ── Аналитика вуза (дашборд UNIVERSITY_ADMIN) ────────────────────────────────
// Всё считает сервер: клиент не досчитывает и не усредняет, иначе цифра в плитке
// и цифра на графике начинают расходиться.

/**
 * Плитки дашборда вуза — `GET /analytics/university/overview`, одним запросом с кэшем.
 * Посещаемость считает сервер по всем отметкам вуза; клиент её не усредняет.
 */
export interface UniversityOverview {
  /** Доля не-пропусков, проценты; null — посещаемость ещё не отмечали. */
  attendanceRate: number | null
  attendanceTracked: number
  submissionsPending: number
  examsUpcoming: number
  /** Группы с отмеченной посещаемостью, худшие первыми (не больше 100). */
  groups: {
    groupId: string
    name: string
    facultyId: string
    attendanceRate: number
    attendanceTracked: number
  }[]
  /** Группы ниже порога «требует внимания». */
  atRisk: AtRiskGroup[]
}

export interface WeeklyPoint {
  /** Понедельник недели, ISO. */
  at: string
  value: number
}

export interface AttendanceTrend {
  weeks: number
  from: string
  series: { facultyId: string; name: string; points: WeeklyPoint[] }[]
}

export interface AttendanceBreakdown {
  items: {
    facultyId: string
    name: string
    present: number
    late: number
    absent: number
    excused: number
  }[]
}

export interface RoomLoad {
  /** grid[dow][hour], dow: 0 = понедельник. */
  grid: number[][]
  peak: number
  /** Сколько учебных аудиторий в вузе — с чем сравнивать пик. */
  rooms: number
}

export interface ExamResultsBreakdown {
  items: {
    facultyId: string
    name: string
    passed: number
    failed: number
    absent: number
    retake: number
  }[]
}

export interface ApplicationsFlow {
  weeks: number
  points: { at: string; submitted: number; closed: number; overdue: number }[]
}

export interface UniversityInvitesFunnel {
  total: number
  pending: number
  used: number
  expired: number
  revoked: number
  /** Доля принятых от всех выданных, проценты. */
  conversion: number
}
