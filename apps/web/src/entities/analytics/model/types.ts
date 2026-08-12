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
