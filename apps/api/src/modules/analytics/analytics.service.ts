import { Injectable } from '@nestjs/common'
import { Role } from '@studenthub/shared-types'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

function isPlatform(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

// Доля не-пропусков: (всего − отсутствовал) / всего, в процентах.
function rateOf(counts: { total: number; absent: number }): number {
  return counts.total === 0 ? 0 : Math.round(((counts.total - counts.absent) / counts.total) * 100)
}

const AT_RISK_THRESHOLD = 60

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Обзор факультета: показатели + посещаемость по группам + «требует внимания». */
  async facultyOverview(viewer: JwtPayload, requestedFacultyId?: string) {
    const facultyId = await this.resolveFaculty(viewer, requestedFacultyId)
    const now = new Date()

    const [groups, students, attendance, submissionsPending, examsUpcoming] = await Promise.all([
      this.prisma.group.findMany({ where: { facultyId }, select: { id: true, name: true } }),
      this.prisma.user.findMany({
        where: {
          facultyId,
          role: { in: ['STUDENT', 'STAROSTA'] },
          deletedAt: null,
          isBlocked: false,
        },
        select: { groupId: true },
        take: 20000,
      }),
      this.prisma.attendance.findMany({
        where: { pair: { group: { facultyId } } },
        select: { status: true, pair: { select: { groupId: true } } },
        take: 50000,
      }),
      this.prisma.submission.count({
        where: { status: 'SUBMITTED', assignment: { course: { group: { facultyId } } } },
      }),
      this.prisma.exam.count({ where: { group: { facultyId }, date: { gte: now } } }),
    ])

    // Студенты по группам.
    const studentByGroup = new Map<string, number>()
    for (const s of students) {
      if (!s.groupId) continue
      studentByGroup.set(s.groupId, (studentByGroup.get(s.groupId) ?? 0) + 1)
    }

    // Посещаемость по группам + факультету.
    const attByGroup = new Map<string, { total: number; absent: number }>()
    const facultyAtt = { total: 0, absent: 0 }
    for (const a of attendance) {
      const gid = a.pair.groupId
      const cur = attByGroup.get(gid) ?? { total: 0, absent: 0 }
      cur.total += 1
      facultyAtt.total += 1
      if (a.status === 'ABSENT') {
        cur.absent += 1
        facultyAtt.absent += 1
      }
      attByGroup.set(gid, cur)
    }

    const groupStats = groups
      .map((g) => {
        const att = attByGroup.get(g.id) ?? { total: 0, absent: 0 }
        return {
          groupId: g.id,
          name: g.name,
          students: studentByGroup.get(g.id) ?? 0,
          attendanceRate: rateOf(att),
          attendanceTracked: att.total,
        }
      })
      .sort((a, b) => a.attendanceRate - b.attendanceRate)

    const atRisk = groupStats.filter(
      (g) => g.attendanceTracked > 0 && g.attendanceRate < AT_RISK_THRESHOLD,
    )

    return {
      facultyId,
      totals: {
        groups: groups.length,
        students: students.length,
        attendanceRate: rateOf(facultyAtt),
        submissionsPending,
        examsUpcoming,
      },
      groups: groupStats,
      atRisk: atRisk.map((g) => ({
        groupId: g.groupId,
        name: g.name,
        attendanceRate: g.attendanceRate,
      })),
    }
  }

  /** Drill-down: посещаемость по студентам группы. */
  async groupAttendance(viewer: JwtPayload, groupId: string) {
    await this.assertGroupScope(viewer, groupId)
    const [students, attendance] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          groupId,
          role: { in: ['STUDENT', 'STAROSTA'] },
          deletedAt: null,
          isBlocked: false,
        },
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        take: 500,
      }),
      this.prisma.attendance.findMany({
        where: { pair: { groupId } },
        select: { studentId: true, status: true },
        take: 20000,
      }),
    ])
    const byStudent = new Map<string, { total: number; absent: number }>()
    for (const a of attendance) {
      const cur = byStudent.get(a.studentId) ?? { total: 0, absent: 0 }
      cur.total += 1
      if (a.status === 'ABSENT') cur.absent += 1
      byStudent.set(a.studentId, cur)
    }
    return {
      groupId,
      students: students.map((s) => {
        const att = byStudent.get(s.id) ?? { total: 0, absent: 0 }
        return {
          studentId: s.id,
          firstName: s.firstName,
          lastName: s.lastName,
          attendanceRate: rateOf(att),
          tracked: att.total,
        }
      }),
    }
  }

  // ── scope ─────────────────────────────────────────────────────────────────

  private async resolveFaculty(viewer: JwtPayload, requested?: string): Promise<string> {
    if (viewer.role === Role.DEAN) {
      if (!viewer.facultyId) throw new AppException('NOT_FOUND', 'Факультет не назначен')
      return viewer.facultyId
    }
    if (!requested) throw new AppException('BAD_REQUEST', 'Не указан факультет')
    if (isPlatform(viewer.role)) return requested
    if (viewer.role === Role.UNIVERSITY_ADMIN || viewer.role === Role.UNIVERSITY_MODERATOR) {
      const faculty = await this.prisma.faculty.findUnique({
        where: { id: requested },
        select: { universityId: true },
      })
      if (!faculty) throw new AppException('NOT_FOUND', 'Факультет не найден')
      if (faculty.universityId !== viewer.universityId) {
        throw new AppException('WRONG_SCOPE', 'Другой университет')
      }
      return requested
    }
    throw new AppException('FORBIDDEN', 'Недостаточно прав')
  }

  private async assertGroupScope(viewer: JwtPayload, groupId: string): Promise<void> {
    if (isPlatform(viewer.role)) return
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { facultyId: true, faculty: { select: { universityId: true } } },
    })
    if (!group) throw new AppException('NOT_FOUND', 'Группа не найдена')
    if (viewer.role === Role.DEAN) {
      if (viewer.facultyId === group.facultyId) return
      throw new AppException('WRONG_SCOPE', 'Другой факультет')
    }
    if (viewer.role === Role.UNIVERSITY_ADMIN || viewer.role === Role.UNIVERSITY_MODERATOR) {
      if (viewer.universityId === group.faculty.universityId) return
      throw new AppException('WRONG_SCOPE', 'Другой университет')
    }
    throw new AppException('FORBIDDEN', 'Недостаточно прав')
  }
}
