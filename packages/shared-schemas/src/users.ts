import { z } from 'zod'
import { Role } from '@studenthub/shared-types'
import { PasswordSchema } from './auth.js'
import { OffsetPaginationSchema } from './pagination.js'
import { RoleSchema } from './invites.js'

// Список пользователей (docs/PROJECT.md §12.2, только Admin+). Scope по роли смотрящего.
export const UserListQuerySchema = OffsetPaginationSchema.extend({
  role: RoleSchema.optional(),
  facultyId: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
  search: z.string().min(1).max(100).optional(),
  blocked: z.coerce.boolean().optional(),
})
export type UserListQueryInput = z.infer<typeof UserListQuerySchema>

// Видимость профиля целиком (docs/PROJECT.md §3.7, «закрытый профиль»): кто видит полную
// карточку. PRIVATE — только владелец и надзорные роли (с аудитом). Порядок = от открытого к закрытому.
export const PROFILE_VISIBILITY = ['PUBLIC', 'UNIVERSITY', 'FACULTY', 'GROUP', 'PRIVATE'] as const
export const ProfileVisibilitySchema = z.enum(PROFILE_VISIBILITY)
export type ProfileVisibilityValue = z.infer<typeof ProfileVisibilitySchema>

// Обновление собственного профиля (docs/PROJECT.md §3.7). Расширенный профиль (стиль ВК):
// общие поля + учёба (студент) + работа (сотрудники). Все опциональны; пустая строка очищает.
const shortText = z.string().max(120)
const longText = z.string().max(2000)
const strList = z.array(z.string().min(1).max(60)).max(30)

export const UpdateProfileSchema = z
  .object({
    // общие
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
    middleName: shortText.optional(),
    showEmail: z.boolean().optional(),
    profileVisibility: ProfileVisibilitySchema.optional(),
    phone: shortText.optional(),
    showPhone: z.boolean().optional(),
    bio: longText.optional(),
    birthDate: z.coerce.date().optional().nullable(),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional().nullable(),
    languages: strList.optional(),
    telegram: shortText.optional(),
    instagram: shortText.optional(),
    website: shortText.optional(),
    headline: shortText.optional(),
    timezone: shortText.optional(),
    country: shortText.optional(),
    // студент / староста
    course: z.coerce.number().int().min(1).max(8).optional().nullable(),
    enrollmentYear: z.coerce.number().int().min(1950).max(2100).optional().nullable(),
    graduationYear: z.coerce.number().int().min(1950).max(2100).optional().nullable(),
    educationLevel: shortText.optional(),
    studyForm: shortText.optional(),
    fundingType: shortText.optional(),
    specialty: shortText.optional(),
    studentCardNumber: shortText.optional(),
    academicStatus: shortText.optional(),
    gpa: z.coerce.number().min(0).max(5).optional().nullable(),
    interests: strList.optional(),
    skills: strList.optional(),
    dormitory: shortText.optional(),
    address: shortText.optional(),
    duties: longText.optional(),
    // сотрудники
    position: shortText.optional(),
    academicDegree: shortText.optional(),
    academicTitle: shortText.optional(),
    department: shortText.optional(),
    subjects: strList.optional(),
    officeRoom: shortText.optional(),
    officeHours: shortText.optional(),
    employeeNumber: shortText.optional(),
    researchInterests: longText.optional(),
    publicationsUrl: shortText.optional(),
    appointmentDate: z.coerce.date().optional().nullable(),
    workPhone: shortText.optional(),
    jobTitle: shortText.optional(),
    responsibilities: longText.optional(),
    moderationAreas: longText.optional(),
  })
  .strict()

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>

// Смена пароля: текущий + новый по политике (docs/BACKEND_RULES.md §3).
export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: PasswordSchema,
  })
  .strict()

export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>

// ── Доступность полей профиля по роли (docs/PROJECT.md §3.7) ─────────────────
// Единый источник истины: форма профиля на фронте и фильтр в UserService читают
// эту карту. Смысл: набор «самоописываемых» полей зависит от роли — у платформенных
// ролей нет кафедры, предметов, учёной степени и табельного номера вуза; у студента
// нет служебных полей. Поле, не разрешённое роли, не показывается в UI и не пишется
// в БД, даже если пришло прямым PATCH.
//
// Record<keyof UpdateProfileInput, …> обязателен намеренно: добавив поле в
// UpdateProfileSchema, его нельзя забыть классифицировать — TypeScript не соберётся.

const EVERY_ROLE: readonly Role[] = Object.values(Role)
const STUDENT_ROLES: readonly Role[] = [Role.STUDENT, Role.STAROSTA]
/** Преподавательские (академические) поля: кафедра, степень, предметы. */
const ACADEMIC_ROLES: readonly Role[] = [Role.TEACHER, Role.DEAN]
/** Сотрудники вуза — у них есть табельный номер, кабинет и дата назначения. */
const UNIVERSITY_STAFF: readonly Role[] = [
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.DEAN,
]
/** Платформенные роли — вне вуза: только служебный минимум. */
const PLATFORM_STAFF: readonly Role[] = [Role.PLATFORM_ADMIN, Role.PLATFORM_MODERATOR]
const MODERATOR_ROLES: readonly Role[] = [Role.PLATFORM_MODERATOR, Role.UNIVERSITY_MODERATOR]
/** Все не-студенты. */
const STAFF_ROLES: readonly Role[] = [...PLATFORM_STAFF, ...UNIVERSITY_STAFF, Role.TEACHER]
/** Роли, у которых профиль «человеческий», а не служебный: студенты и преподаватели. */
const PERSONAL_ROLES: readonly Role[] = [...STUDENT_ROLES, ...ACADEMIC_ROLES]
const EMPLOYEE_ROLES: readonly Role[] = [...ACADEMIC_ROLES, ...UNIVERSITY_STAFF]

export type ProfileFieldKey = keyof UpdateProfileInput

export const PROFILE_FIELD_ROLES: Readonly<Record<ProfileFieldKey, readonly Role[]>> = {
  // Общие: идентификация, контактность, приватность — нужны каждой роли.
  firstName: EVERY_ROLE,
  lastName: EVERY_ROLE,
  middleName: EVERY_ROLE,
  headline: EVERY_ROLE,
  bio: EVERY_ROLE,
  phone: EVERY_ROLE,
  showPhone: EVERY_ROLE,
  showEmail: EVERY_ROLE,
  profileVisibility: EVERY_ROLE,
  telegram: EVERY_ROLE,
  languages: EVERY_ROLE,
  // Часовой пояс нужен и служебным ролям: дежурства, окна обслуживания, чтение аудита.
  timezone: EVERY_ROLE,

  // Личное и соцсети: студентам и преподавателям. Служебным роли не собираем —
  // меньше персональных данных в базе, меньше утечки.
  birthDate: PERSONAL_ROLES,
  gender: PERSONAL_ROLES,
  country: PERSONAL_ROLES,
  website: PERSONAL_ROLES,
  instagram: STUDENT_ROLES,

  // Учёба — студент и староста.
  course: STUDENT_ROLES,
  enrollmentYear: STUDENT_ROLES,
  graduationYear: STUDENT_ROLES,
  educationLevel: STUDENT_ROLES,
  studyForm: STUDENT_ROLES,
  fundingType: STUDENT_ROLES,
  specialty: STUDENT_ROLES,
  studentCardNumber: STUDENT_ROLES,
  academicStatus: STUDENT_ROLES,
  gpa: STUDENT_ROLES,
  dormitory: STUDENT_ROLES,
  address: STUDENT_ROLES,
  interests: STUDENT_ROLES,
  skills: STUDENT_ROLES,
  duties: [Role.STAROSTA],

  // Академические — только преподаватель и декан.
  academicDegree: ACADEMIC_ROLES,
  academicTitle: ACADEMIC_ROLES,
  department: ACADEMIC_ROLES,
  subjects: ACADEMIC_ROLES,
  officeHours: ACADEMIC_ROLES,
  researchInterests: ACADEMIC_ROLES,
  publicationsUrl: ACADEMIC_ROLES,

  // Служебные внутри вуза: табельный номер и кабинет выдаёт вуз, платформенной роли их не даём.
  employeeNumber: EMPLOYEE_ROLES,
  appointmentDate: EMPLOYEE_ROLES,
  officeRoom: EMPLOYEE_ROLES,
  jobTitle: EMPLOYEE_ROLES,

  // Служебные у всех не-студентов.
  position: STAFF_ROLES,
  workPhone: STAFF_ROLES,
  responsibilities: [...UNIVERSITY_STAFF, ...PLATFORM_STAFF],
  // Зона модерации — только у модераторов.
  moderationAreas: MODERATOR_ROLES,
}

/** Разрешено ли роли заполнять это поле профиля. */
export function profileFieldAllowed(field: ProfileFieldKey, role: Role): boolean {
  return PROFILE_FIELD_ROLES[field].includes(role)
}

/** Список полей профиля, доступных роли (порядок = порядок объявления в карте). */
export function profileFieldsForRole(role: Role): ProfileFieldKey[] {
  return (Object.keys(PROFILE_FIELD_ROLES) as ProfileFieldKey[]).filter((f) =>
    profileFieldAllowed(f, role),
  )
}

/**
 * Поля DTO, недоступные роли. Пустой массив — запрос валиден.
 * Роль передаётся вызывающим из JWT, никогда из тела (docs/BACKEND_RULES.md §0).
 * Вызывающий отвечает на непустой результат ошибкой 400, а не тихим отбрасыванием:
 * молчаливый игнор выглядел бы для клиента как успешное сохранение.
 */
export function disallowedProfileFields(role: Role, input: UpdateProfileInput): ProfileFieldKey[] {
  return (Object.keys(input) as ProfileFieldKey[]).filter((key) => !profileFieldAllowed(key, role))
}
