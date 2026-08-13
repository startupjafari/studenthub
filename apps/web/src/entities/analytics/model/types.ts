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
