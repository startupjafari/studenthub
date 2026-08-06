import { z } from 'zod'
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
