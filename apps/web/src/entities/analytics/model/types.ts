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
  status: string
  students: number
  teachers: number
  total: number
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
  /** cells[dow][hour], dow: 0 = понедельник. */
  cells: number[][]
  max: number
}

export interface TopActions {
  from: string
  to: string
  items: { action: string; value: number }[]
}
