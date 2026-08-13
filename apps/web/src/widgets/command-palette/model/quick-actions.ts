import { Role } from '@studenthub/shared-types'
import {
  Award,
  BarChart3,
  BookOpen,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  FileText,
  GraduationCap,
  ListChecks,
  MessagesSquare,
  Table2,
  Users,
  type LucideIcon,
} from 'lucide-react'

// Быстрое действие палитры: ключ i18n (namespace Nav) + маршрут + иконка.
export interface QuickAction {
  navKey: string
  href: string
  icon: LucideIcon
}

const STUDENT: QuickAction[] = [
  { navKey: 'today', href: '/today', icon: CalendarCheck },
  { navKey: 'schedule', href: '/schedule', icon: CalendarDays },
  { navKey: 'courses', href: '/courses', icon: BookOpen },
  { navKey: 'assignments', href: '/assignments', icon: ClipboardList },
  { navKey: 'grades', href: '/grades', icon: GraduationCap },
  { navKey: 'exams', href: '/exams', icon: Award },
  { navKey: 'calendar', href: '/calendar', icon: CalendarRange },
  { navKey: 'tasks', href: '/tasks', icon: ListChecks },
  { navKey: 'chats', href: '/chats', icon: MessagesSquare },
]

const TEACHER: QuickAction[] = [
  { navKey: 'today', href: '/teacher/today', icon: CalendarCheck },
  { navKey: 'schedule', href: '/teacher/schedule', icon: CalendarDays },
  { navKey: 'assignments', href: '/teacher/assignments', icon: ClipboardList },
  { navKey: 'gradebook', href: '/teacher/gradebook', icon: Table2 },
  { navKey: 'attendance', href: '/teacher/attendance', icon: ClipboardCheck },
  { navKey: 'exams', href: '/teacher/exams', icon: Award },
  { navKey: 'chats', href: '/teacher/chats', icon: MessagesSquare },
]

const DEAN: QuickAction[] = [
  { navKey: 'today', href: '/dean/today', icon: CalendarCheck },
  { navKey: 'analytics', href: '/dean/analytics', icon: BarChart3 },
  { navKey: 'courses', href: '/dean/courses', icon: BookOpen },
  { navKey: 'exams', href: '/dean/exams', icon: Award },
  { navKey: 'applications', href: '/dean/applications', icon: FileText },
  { navKey: 'schedule', href: '/dean/schedule', icon: CalendarDays },
  { navKey: 'chats', href: '/dean/chats', icon: MessagesSquare },
]

// Староста = студент + управление своей группой: студенческие быстрые действия и сверх них
// старостовские (личные schedule/chats/applications ведут на общие студенческие роуты).
const STAROSTA: QuickAction[] = [
  ...STUDENT,
  { navKey: 'myGroup', href: '/starosta/group', icon: Users },
  { navKey: 'classmates', href: '/starosta/classmates', icon: GraduationCap },
  { navKey: 'groupRequests', href: '/starosta/group-requests', icon: ClipboardList },
]

const UNIVERSITY_ADMIN: QuickAction[] = [
  { navKey: 'courses', href: '/university-admin/courses', icon: BookOpen },
  { navKey: 'schedule', href: '/university-admin/schedule', icon: CalendarDays },
  { navKey: 'applications', href: '/university-admin/applications', icon: FileText },
  { navKey: 'chats', href: '/university-admin/chats', icon: MessagesSquare },
]

const BY_ROLE: Partial<Record<Role, QuickAction[]>> = {
  [Role.STUDENT]: STUDENT,
  [Role.STAROSTA]: STAROSTA,
  [Role.TEACHER]: TEACHER,
  [Role.DEAN]: DEAN,
  [Role.UNIVERSITY_ADMIN]: UNIVERSITY_ADMIN,
}

export function quickActionsFor(role: Role | null): QuickAction[] {
  if (!role) return []
  return BY_ROLE[role] ?? []
}
