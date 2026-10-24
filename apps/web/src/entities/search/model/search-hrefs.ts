import { Role } from '@studenthub/shared-types'

/**
 * Куда ведёт строка глобального поиска — по роли смотрящего (FRONTEND_RULES §3, PROJECT §12).
 *
 * Раньше ссылки были студенческими для всех: преподаватель, найдя своё задание, попадал на
 * экран сдачи с «Сдать» и «Сохранить черновик», а дисциплины и материалы открывались в
 * студенческом Course Workspace. У каждой роли — свой экран того же раздела; где у роли
 * такого экрана нет (модераторы, платформа), строка не показывается: вести на чужой экран
 * хуже, чем не вести никуда.
 */
export interface SearchHrefs {
  course: ((subject: string) => string) | null
  assignment: ((id: string) => string) | null
  material: ((subject: string | null) => string) | null
  event: (id: string) => string
  chat: (id: string) => string
}

// Экран события один на всех (`/events/<id>`): ролевые разделы событий ведут туда же.
const eventHref = (id: string) => `/events/${encodeURIComponent(id)}`

// Чаты — экран своей роли; конкретный чат открывает параметр `?chat=` (ChatWindow).
const chatHref = (base: string) => (id: string) => `${base}?chat=${encodeURIComponent(id)}`

const STUDENT_HREFS: SearchHrefs = {
  course: (subject) => `/courses/${encodeURIComponent(subject)}`,
  // Диплинк в конкретное задание (роут /assignments раскрывает деталь по ?open=).
  assignment: (id) => `/assignments?open=${encodeURIComponent(id)}`,
  // Отдельного роута /materials у студента нет; материалы живут во вкладке курса.
  material: (subject) => (subject ? `/courses/${encodeURIComponent(subject)}` : '/courses'),
  event: eventHref,
  chat: chatHref('/chats'),
}

const HREFS_BY_ROLE: Partial<Record<Role, SearchHrefs>> = {
  [Role.STUDENT]: STUDENT_HREFS,
  // Личная учёба старосты — те же студенческие экраны (STAROSTA_NAV).
  [Role.STAROSTA]: STUDENT_HREFS,
  [Role.TEACHER]: {
    // Дисциплины преподавателя — его журнал оценок (выбор курса там же).
    course: () => '/teacher/gradebook',
    // Экран проверки раскрывает задание по ?open=, как диплинк из очереди на главной.
    assignment: (id) => `/teacher/assignments?open=${encodeURIComponent(id)}`,
    material: () => '/teacher/materials',
    event: eventHref,
    chat: chatHref('/teacher/chats'),
  },
  // Декану и админу вуза дисциплины, задания и материалы видны в управлении дисциплинами.
  [Role.DEAN]: {
    course: () => '/dean/courses',
    assignment: () => '/dean/courses',
    material: () => '/dean/courses',
    event: eventHref,
    chat: chatHref('/dean/chats'),
  },
  [Role.UNIVERSITY_ADMIN]: {
    course: () => '/university-admin/courses',
    assignment: () => '/university-admin/courses',
    material: () => '/university-admin/courses',
    event: eventHref,
    chat: chatHref('/university-admin/chats'),
  },
  [Role.UNIVERSITY_MODERATOR]: {
    course: null,
    assignment: null,
    material: null,
    event: eventHref,
    chat: chatHref('/moderator/university/chats'),
  },
  [Role.PLATFORM_ADMIN]: {
    course: null,
    assignment: null,
    material: null,
    event: eventHref,
    chat: chatHref('/platform-admin/chats'),
  },
  [Role.PLATFORM_MODERATOR]: {
    course: null,
    assignment: null,
    material: null,
    event: eventHref,
    chat: chatHref('/moderator/platform/chats'),
  },
}

/** Ссылки строк поиска для роли; роль ещё не восстановлена — студенческие, как раньше. */
export function searchHrefsFor(role: Role | null | undefined): SearchHrefs {
  return (role && HREFS_BY_ROLE[role]) || STUDENT_HREFS
}
