import { Role } from '@studenthub/shared-types'
import {
  Award,
  BarChart3,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  DoorClosed,
  FileCog,
  FileText,
  FolderLock,
  FolderOpen,
  GraduationCap,
  Handshake,
  Home,
  IdCard,
  LayoutDashboard,
  ListChecks,
  MessagesSquare,
  Milestone,
  Newspaper,
  ScanLine,
  ScrollText,
  Search,
  Send,
  Table2,
  ShieldAlert,
  FileUser,
  TrendingUp,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  // Ключ i18n в namespace Nav.
  key: string
  href: string
  icon: LucideIcon
  // Точное совпадение пути (для дашбордов-индексов вида /dean, чтобы не подсвечиваться на под-роутах).
  exact?: boolean
  // Ключ i18n группы (namespace Nav.group). Заголовки секций показываются, только если у
  // навигации ≥2 групп (сейчас — студенческая); иначе список плоский, как раньше.
  group?: string
}

// Вариант навигации — сериализуемый пропс для AppShell (иконки резолвятся в клиенте).
export type NavVariant =
  | 'student'
  | 'university-admin'
  | 'dean'
  | 'teacher'
  | 'starosta'
  | 'platform-admin'
  | 'platform-moderator'
  | 'university-moderator'
  | 'employer'

// Навигация студенческого дашборда (docs/PROJECT.md §12).
// Профиль — плашка пользователя внизу сайдбара (см. AppSidebar), не пункт навигации.
export const STUDENT_NAV: NavItem[] = [
  { key: 'today', href: '/today', icon: CalendarCheck, group: 'main' },
  { key: 'feed', href: '/', icon: Home, group: 'main' },
  { key: 'schedule', href: '/schedule', icon: CalendarDays, group: 'main' },
  { key: 'calendar', href: '/calendar', icon: CalendarRange, group: 'main' },
  { key: 'tasks', href: '/tasks', icon: ListChecks, group: 'main' },
  { key: 'academic', href: '/academic', icon: TrendingUp, group: 'study' },
  { key: 'courses', href: '/courses', icon: BookOpen, group: 'study' },
  { key: 'assignments', href: '/assignments', icon: ClipboardList, group: 'study' },
  { key: 'attendance', href: '/attendance', icon: ClipboardCheck, group: 'study' },
  { key: 'grades', href: '/grades', icon: GraduationCap, group: 'study' },
  { key: 'exams', href: '/exams', icon: Award, group: 'study' },
  { key: 'studyPlan', href: '/study-plan', icon: Milestone, group: 'study' },
  { key: 'consultations', href: '/consultations', icon: Handshake, group: 'services' },
  { key: 'appointments', href: '/appointments', icon: CalendarClock, group: 'services' },
  { key: 'portfolio', href: '/portfolio', icon: BriefcaseBusiness, group: 'services' },
  { key: 'studentId', href: '/student-id', icon: IdCard, group: 'services' },
  { key: 'applications', href: '/applications', icon: FileText, group: 'services' },
  { key: 'chats', href: '/chats', icon: MessagesSquare, group: 'communication' },
  { key: 'events', href: '/events', icon: CalendarClock, group: 'communication' },
]

// Навигация администратора университета (Фаза 5.6).
// Двадцать пунктов подряд не читались — сгруппированы по смыслу. Порядок секций задаётся
// первым появлением группы в массиве (см. toSections в AppSidebar), поэтому пункты внутри
// группы должны идти подряд.
export const UNIVERSITY_ADMIN_NAV: NavItem[] = [
  // Обзор: куда админ смотрит первым делом.
  {
    key: 'dashboard',
    href: '/university-admin',
    icon: LayoutDashboard,
    exact: true,
    group: 'main',
  },
  { key: 'analytics', href: '/university-admin/analytics', icon: BarChart3, group: 'main' },

  // Структура вуза: то, что заводят один раз и меняют редко.
  { key: 'faculties', href: '/university-admin/faculties', icon: Building2, group: 'structure' },
  { key: 'specialties', href: '/university-admin/specialties', icon: ScrollText, group: 'structure' }, // prettier-ignore
  { key: 'groups', href: '/university-admin/groups', icon: Users, group: 'structure' },
  // Ф16: помещения и печатные QR над дверью.
  { key: 'rooms', href: '/university-admin/rooms', icon: DoorClosed, group: 'structure' },

  // Учебный процесс.
  { key: 'schedule', href: '/university-admin/schedule', icon: CalendarDays, group: 'study' },
  { key: 'courses', href: '/university-admin/courses', icon: BookOpen, group: 'study' },

  // Люди: выдача доступа и списки по ролям.
  { key: 'invites', href: '/university-admin/invites', icon: Send, group: 'people' },
  { key: 'students', href: '/university-admin/students', icon: GraduationCap, group: 'people' },
  { key: 'teachers', href: '/university-admin/teachers', icon: BookOpen, group: 'people' },
  { key: 'deans', href: '/university-admin/deans', icon: UserCog, group: 'people' },

  // Обслуживание студентов.
  {
    key: 'applications',
    href: '/university-admin/applications',
    icon: FileText,
    group: 'services',
  },
  { key: 'verifyId', href: '/verify-id', icon: ScanLine, group: 'services' },
  { key: 'documentTypes', href: '/university-admin/document-types', icon: FileCog, group: 'services' }, // prettier-ignore

  // Коммуникации вуза.
  { key: 'posts', href: '/university-admin/posts', icon: Newspaper, group: 'communication' },
  { key: 'events', href: '/university-admin/events', icon: CalendarClock, group: 'communication' },
  { key: 'chats', href: '/university-admin/chats', icon: MessagesSquare, group: 'communication' },

  // Контроль: разбор жалоб и журнал действий.
  { key: 'complaints', href: '/university-admin/complaints', icon: ShieldAlert, group: 'control' },
  { key: 'audit', href: '/university-admin/audit', icon: ScrollText, group: 'control' },
]

// Ролевые дашборды (docs/PROJECT.md §12). У каждого пункта ниже есть свой экран;
// catch-all [...section] в ролевых сегментах остался предохранителем для неизвестных URL
// (например ссылки на раздел, которого больше нет), а не «разделом в разработке».
export const DEAN_NAV: NavItem[] = [
  { key: 'today', href: '/dean/today', icon: CalendarCheck },
  { key: 'dashboard', href: '/dean', icon: LayoutDashboard, exact: true },
  { key: 'groups', href: '/dean/groups', icon: Users },
  { key: 'students', href: '/dean/students', icon: GraduationCap },
  { key: 'teachers', href: '/dean/teachers', icon: BookOpen },
  { key: 'starostas', href: '/dean/starostas', icon: UserCog },
  { key: 'verifyId', href: '/verify-id', icon: ScanLine },
  { key: 'schedule', href: '/dean/schedule', icon: CalendarDays },
  { key: 'calendar', href: '/calendar', icon: CalendarRange },
  { key: 'courses', href: '/dean/courses', icon: BookOpen },
  { key: 'exams', href: '/dean/exams', icon: Award },
  { key: 'analytics', href: '/dean/analytics', icon: BarChart3 },
  { key: 'appointments', href: '/dean/appointments', icon: CalendarClock },
  { key: 'applications', href: '/dean/applications', icon: FileText },
  { key: 'posts', href: '/dean/posts', icon: Newspaper },
  { key: 'invites', href: '/dean/invites', icon: Send },
  { key: 'chats', href: '/dean/chats', icon: MessagesSquare },
  { key: 'events', href: '/dean/events', icon: CalendarClock },
]

export const TEACHER_NAV: NavItem[] = [
  { key: 'today', href: '/teacher/today', icon: CalendarCheck },
  { key: 'dashboard', href: '/teacher', icon: LayoutDashboard, exact: true },
  { key: 'schedule', href: '/teacher/schedule', icon: CalendarDays },
  { key: 'groups', href: '/teacher/groups', icon: Users },
  { key: 'verifyId', href: '/verify-id', icon: ScanLine },
  { key: 'assignments', href: '/teacher/assignments', icon: ClipboardList },
  { key: 'attendance', href: '/teacher/attendance', icon: ClipboardCheck },
  { key: 'gradebook', href: '/teacher/gradebook', icon: Table2 },
  { key: 'exams', href: '/teacher/exams', icon: Award },
  { key: 'consultations', href: '/teacher/consultations', icon: Handshake },
  { key: 'materials', href: '/teacher/materials', icon: FolderOpen },
  { key: 'calendar', href: '/calendar', icon: CalendarRange },
  { key: 'posts', href: '/teacher/posts', icon: Newspaper },
  { key: 'chats', href: '/teacher/chats', icon: MessagesSquare },
  { key: 'events', href: '/teacher/events', icon: CalendarClock },
]

// Староста — это студент с «преимуществом над группой»: у него ВСЕ студенческие
// вкладки (личная учёба — те же экраны и роуты, что у студента), плюс отдельная
// секция управления своей группой. Личные /starosta/{schedule,chats,events,applications}
// раньше просто дублировали студенческие view — теперь ведём на общие студенческие роуты.
export const STAROSTA_NAV: NavItem[] = [
  ...STUDENT_NAV,
  { key: 'dashboard', href: '/starosta', icon: LayoutDashboard, exact: true, group: 'starosta' },
  { key: 'myGroup', href: '/starosta/group', icon: Users, group: 'starosta' },
  { key: 'classmates', href: '/starosta/classmates', icon: GraduationCap, group: 'starosta' },
  {
    key: 'groupRequests',
    href: '/starosta/group-requests',
    icon: ClipboardList,
    group: 'starosta',
  },
  { key: 'invites', href: '/starosta/invites', icon: Send, group: 'starosta' },
]

export const PLATFORM_ADMIN_NAV: NavItem[] = [
  { key: 'dashboard', href: '/platform-admin', icon: LayoutDashboard, exact: true },
  { key: 'universities', href: '/platform-admin/universities', icon: Building2 },
  { key: 'users', href: '/platform-admin/users', icon: Users },
  { key: 'invites', href: '/platform-admin/invites', icon: Send },
  { key: 'complaints', href: '/platform-admin/complaints', icon: ShieldAlert },
  { key: 'stats', href: '/platform-admin/stats', icon: BarChart3 },
  { key: 'audit', href: '/platform-admin/audit', icon: ScrollText },
  { key: 'documentAccess', href: '/platform-admin/document-access', icon: FolderLock },
  { key: 'chats', href: '/platform-admin/chats', icon: MessagesSquare },
]

export const PLATFORM_MODERATOR_NAV: NavItem[] = [
  { key: 'dashboard', href: '/moderator/platform', icon: LayoutDashboard, exact: true },
  { key: 'complaints', href: '/moderator/platform/complaints', icon: ShieldAlert },
  { key: 'posts', href: '/moderator/platform/posts', icon: Newspaper },
  { key: 'users', href: '/moderator/platform/users', icon: Users },
  { key: 'stats', href: '/moderator/platform/stats', icon: BarChart3 },
  { key: 'audit', href: '/moderator/platform/audit', icon: ScrollText },
  { key: 'chats', href: '/moderator/platform/chats', icon: MessagesSquare },
]

export const UNIVERSITY_MODERATOR_NAV: NavItem[] = [
  { key: 'dashboard', href: '/moderator/university', icon: LayoutDashboard, exact: true },
  { key: 'complaints', href: '/moderator/university/complaints', icon: ShieldAlert },
  { key: 'posts', href: '/moderator/university/posts', icon: Newspaper },
  { key: 'users', href: '/moderator/university/users', icon: Users },
  { key: 'audit', href: '/moderator/university/audit', icon: ScrollText },
  { key: 'chats', href: '/moderator/university/chats', icon: MessagesSquare },
]

// Навигация определяется РОЛЬЮ пользователя, а не route-группой: общие страницы
// (например /profile) должны сохранять сайдбар текущей роли. AppShell берёт вариант отсюда.
export const ROLE_TO_VARIANT: Record<Role, NavVariant> = {
  [Role.PLATFORM_ADMIN]: 'platform-admin',
  [Role.PLATFORM_MODERATOR]: 'platform-moderator',
  [Role.UNIVERSITY_ADMIN]: 'university-admin',
  [Role.UNIVERSITY_MODERATOR]: 'university-moderator',
  [Role.DEAN]: 'dean',
  [Role.TEACHER]: 'teacher',
  [Role.STAROSTA]: 'starosta',
  [Role.STUDENT]: 'student',
  [Role.EMPLOYER]: 'employer',
}

// Документы — общий пункт для всех ролей: защищённое хранилище (Ф15, отдельный раздел /documents).
// Уведомления в навигации нет — они открываются колоколом рядом с логотипом (оверлей сайдбара).
export const DOCUMENTS_NAV: NavItem = {
  key: 'documents',
  href: '/documents',
  icon: FolderLock,
  group: 'services',
}

// Друзья намеренно НЕ в навигации: заявки приходят в уведомления (принять/отклонить прямо там),
// а связи управляются кнопками в профилях пользователей. Отдельного раздела /friends нет.

// Добавляет общие пункты («Документы») в конец любой ролевой навигации.
function withCommon(items: NavItem[]): NavItem[] {
  return [...items, DOCUMENTS_NAV]
}

// Резолв конфига по варианту. Массив содержит иконки-функции — резолвится в клиенте
// (нельзя передавать пропом server→client, RSC-ограничение).
// Навигация работодателя. Разделы платформы ему не показываются вообще: он видит
// свою компанию, статус допусков и (со следующих под-фаз) вакансии и кандидатов.
export const EMPLOYER_NAV: NavItem[] = [
  { key: 'careerHome', href: '/employer', icon: LayoutDashboard, exact: true },
  { key: 'companyProfile', href: '/employer/company', icon: Building2 },
  { key: 'universityAccess', href: '/employer/access', icon: GraduationCap },
]

export const NAV_BY_VARIANT: Record<NavVariant, NavItem[]> = {
  student: withCommon(STUDENT_NAV),
  'university-admin': withCommon(UNIVERSITY_ADMIN_NAV),
  dean: withCommon(DEAN_NAV),
  teacher: withCommon(TEACHER_NAV),
  starosta: withCommon(STAROSTA_NAV),
  'platform-admin': withCommon(PLATFORM_ADMIN_NAV),
  'platform-moderator': withCommon(PLATFORM_MODERATOR_NAV),
  'university-moderator': withCommon(UNIVERSITY_MODERATOR_NAV),
  // Без withCommon: общий раздел «Документы» — хранилище участника вуза, работодателя
  // оно не касается.
  employer: EMPLOYER_NAV,
}

// ── StudentHub Карьера ──────────────────────────────────────────────────────
// Отдельный продукт со своей навигацией: пока пользователь под /career, сайдбар
// показывает эти пункты вместо разделов платформы. Переключение — через логотип
// (ProductSwitcher), отдельного пункта «Карьера» в основной навигации нет.
//
// Стажировок отдельным разделом нет намеренно: на MVP это вакансия с типом
// «стажировка» и обычный отклик (см. план Фазы 18).

/** Корень карьерного продукта. Всё, что под ним, показывает карьерную навигацию. */
export const CAREER_ROOT = '/career'

// Студент и староста: ищут работу.
export const CAREER_STUDENT_NAV: NavItem[] = [
  { key: 'careerHome', href: '/career', icon: LayoutDashboard, exact: true },
  { key: 'vacancies', href: '/career/vacancies', icon: Search },
  { key: 'careerApplications', href: '/career/applications', icon: Send },
  { key: 'careerProfile', href: '/career/profile', icon: BriefcaseBusiness },
  { key: 'resume', href: '/career/resume', icon: FileUser },
  { key: 'careerEvents', href: '/career/events', icon: CalendarDays },
]

// Сотрудники вуза: карьерный центр — допуск компаний и модерация вакансий.
export const CAREER_STAFF_NAV: NavItem[] = [
  { key: 'careerHome', href: '/career', icon: LayoutDashboard, exact: true },
  { key: 'companies', href: '/career/companies', icon: Building2 },
  { key: 'vacancies', href: '/career/vacancies', icon: Search },
  { key: 'careerEvents', href: '/career/events', icon: CalendarDays },
]

const CAREER_NAV_BY_ROLE: Record<Role, NavItem[]> = {
  [Role.STUDENT]: CAREER_STUDENT_NAV,
  [Role.STAROSTA]: CAREER_STUDENT_NAV,
  // Преподаватель в карьерном модуле — наблюдатель: своих действий у него пока нет,
  // но события и вакансии видеть логично.
  [Role.TEACHER]: CAREER_STAFF_NAV,
  [Role.DEAN]: CAREER_STAFF_NAV,
  [Role.UNIVERSITY_ADMIN]: CAREER_STAFF_NAV,
  [Role.UNIVERSITY_MODERATOR]: CAREER_STAFF_NAV,
  [Role.PLATFORM_ADMIN]: CAREER_STAFF_NAV,
  [Role.PLATFORM_MODERATOR]: CAREER_STAFF_NAV,
  // Работодатель в /career не заходит — его продукт целиком в зоне /employer.
  // Значение задано, чтобы карта была исчерпывающей и не пришлось падать на undefined.
  [Role.EMPLOYER]: EMPLOYER_NAV,
}

/** Навигация карьерного продукта для роли. */
export function careerNavFor(role: Role | undefined): NavItem[] {
  return role ? CAREER_NAV_BY_ROLE[role] : CAREER_STUDENT_NAV
}

/** Путь относится к карьерному продукту. */
export function isCareerPath(pathname: string): boolean {
  return pathname === CAREER_ROOT || pathname.startsWith(`${CAREER_ROOT}/`)
}
