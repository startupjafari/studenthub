import { Role } from '@studenthub/shared-types'
import {
  Award,
  BarChart3,
  BookOpen,
  Building2,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  FileText,
  FolderLock,
  GraduationCap,
  LayoutDashboard,
  ListChecks,
  MessagesSquare,
  Newspaper,
  ScrollText,
  Send,
  ShieldAlert,
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
  { navKey: 'dashboard', href: '/university-admin', icon: LayoutDashboard },
  { navKey: 'courses', href: '/university-admin/courses', icon: BookOpen },
  { navKey: 'schedule', href: '/university-admin/schedule', icon: CalendarDays },
  { navKey: 'applications', href: '/university-admin/applications', icon: FileText },
  { navKey: 'invites', href: '/university-admin/invites', icon: Send },
  { navKey: 'chats', href: '/university-admin/chats', icon: MessagesSquare },
]

const PLATFORM_ADMIN: QuickAction[] = [
  { navKey: 'dashboard', href: '/platform-admin', icon: LayoutDashboard },
  { navKey: 'universities', href: '/platform-admin/universities', icon: Building2 },
  { navKey: 'users', href: '/platform-admin/users', icon: Users },
  { navKey: 'complaints', href: '/platform-admin/complaints', icon: ShieldAlert },
  { navKey: 'stats', href: '/platform-admin/stats', icon: BarChart3 },
  { navKey: 'audit', href: '/platform-admin/audit', icon: ScrollText },
  { navKey: 'documentAccess', href: '/platform-admin/document-access', icon: FolderLock },
]

const PLATFORM_MODERATOR: QuickAction[] = [
  { navKey: 'dashboard', href: '/moderator/platform', icon: LayoutDashboard },
  { navKey: 'complaints', href: '/moderator/platform/complaints', icon: ShieldAlert },
  { navKey: 'posts', href: '/moderator/platform/posts', icon: Newspaper },
  { navKey: 'users', href: '/moderator/platform/users', icon: Users },
  { navKey: 'audit', href: '/moderator/platform/audit', icon: ScrollText },
]

const UNIVERSITY_MODERATOR: QuickAction[] = [
  { navKey: 'dashboard', href: '/moderator/university', icon: LayoutDashboard },
  { navKey: 'complaints', href: '/moderator/university/complaints', icon: ShieldAlert },
  { navKey: 'posts', href: '/moderator/university/posts', icon: Newspaper },
  { navKey: 'users', href: '/moderator/university/users', icon: Users },
  { navKey: 'audit', href: '/moderator/university/audit', icon: ScrollText },
]

// Общий для всех ролей раздел (см. DOCUMENTS_NAV в навигации): в палитре он тоже
// уместен — «Документы» ищут по названию раздела чаще, чем по имени файла.
const DOCUMENTS: QuickAction = { navKey: 'documents', href: '/documents', icon: FolderLock }

// Работодатель (Ф18): разделы его собственной зоны. Общий «Документы» ему не добавляется —
// см. quickActionsFor.
const EMPLOYER: QuickAction[] = [
  { navKey: 'companyProfile', href: '/employer/company', icon: Building2 },
  { navKey: 'universityAccess', href: '/employer/access', icon: GraduationCap },
]

// Быстрые действия есть у КАЖДОЙ роли: пустая палитра при открытии — это экран
// «введите запрос», на котором нечего выбрать, и первое, что видит администратор.
const BY_ROLE: Record<Role, QuickAction[]> = {
  [Role.STUDENT]: STUDENT,
  [Role.STAROSTA]: STAROSTA,
  [Role.TEACHER]: TEACHER,
  [Role.DEAN]: DEAN,
  [Role.UNIVERSITY_ADMIN]: UNIVERSITY_ADMIN,
  [Role.UNIVERSITY_MODERATOR]: UNIVERSITY_MODERATOR,
  [Role.PLATFORM_ADMIN]: PLATFORM_ADMIN,
  [Role.PLATFORM_MODERATOR]: PLATFORM_MODERATOR,
  [Role.EMPLOYER]: EMPLOYER,
}

export function quickActionsFor(role: Role | null): QuickAction[] {
  if (!role) return []
  // Работодателю общий раздел «Документы» не показываем: это хранилище участника вуза.
  if (role === Role.EMPLOYER) return BY_ROLE[role]
  return [...BY_ROLE[role], DOCUMENTS]
}
