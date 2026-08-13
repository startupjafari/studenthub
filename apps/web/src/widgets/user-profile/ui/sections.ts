import { Role } from '@studenthub/shared-types'
import type { UpdateProfileInput } from '@studenthub/shared-schemas'

// Конфиг секций/полей профиля (data-driven). Порядок = порядок отображения.
// Используется и в режиме просмотра, и в форме редактирования — единый источник истины.

export const STUDENT_ROLES: Role[] = [Role.STUDENT, Role.STAROSTA]

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'year'
  | 'list'
  | 'gender'
  | 'phone'
  | 'url'
  | 'telegram'
  | 'instagram'

// dict — справочник для поля (выбор из значений + свой ввод). list+dict → мультивыбор,
// иначе одиночный Select. Языки/страны рисуются с флагами.
export type DictKind =
  | 'skills'
  | 'interests'
  | 'languages'
  | 'countries'
  | 'maritalStatus'
  | 'timezone'
  | 'educationLevel'
  | 'studyForm'
  | 'fundingType'
  | 'academicStatus'
  | 'dormitory'
  | 'specialty'

export interface FieldDef {
  key: keyof UpdateProfileInput
  type: FieldType
  dict?: DictKind
}

export interface Section {
  title: string // i18n-ключ (Profile namespace)
  when: 'all' | 'student' | 'starosta' | 'staff'
  fields: FieldDef[]
}

export const SECTIONS: Section[] = [
  {
    title: 'sectionAbout',
    when: 'all',
    fields: [{ key: 'bio', type: 'textarea' }],
  },
  {
    title: 'sectionContacts',
    when: 'all',
    fields: [
      { key: 'phone', type: 'phone' },
      { key: 'telegram', type: 'telegram' },
      { key: 'instagram', type: 'instagram' },
      { key: 'website', type: 'url' },
    ],
  },
  {
    title: 'sectionPersonal',
    when: 'all',
    fields: [
      { key: 'birthDate', type: 'date' },
      { key: 'gender', type: 'gender' },
      { key: 'country', type: 'text', dict: 'countries' },
      { key: 'languages', type: 'list', dict: 'languages' },
      { key: 'timezone', type: 'text', dict: 'timezone' },
    ],
  },
  {
    title: 'sectionStudy',
    when: 'student',
    fields: [
      { key: 'course', type: 'number' },
      { key: 'educationLevel', type: 'text', dict: 'educationLevel' },
      { key: 'studyForm', type: 'text', dict: 'studyForm' },
      { key: 'fundingType', type: 'text', dict: 'fundingType' },
      { key: 'specialty', type: 'text', dict: 'specialty' },
      { key: 'enrollmentYear', type: 'year' },
      { key: 'graduationYear', type: 'year' },
      { key: 'gpa', type: 'number' },
      { key: 'academicStatus', type: 'text', dict: 'academicStatus' },
      { key: 'studentCardNumber', type: 'number' },
      { key: 'dormitory', type: 'text', dict: 'dormitory' },
      { key: 'address', type: 'text' },
    ],
  },
  {
    title: 'sectionStarosta',
    when: 'starosta',
    fields: [{ key: 'duties', type: 'textarea' }],
  },
  {
    title: 'sectionWork',
    when: 'staff',
    fields: [
      { key: 'position', type: 'text' },
      { key: 'jobTitle', type: 'text' },
      { key: 'academicDegree', type: 'text' },
      { key: 'academicTitle', type: 'text' },
      { key: 'department', type: 'text' },
      { key: 'subjects', type: 'list' },
      { key: 'officeRoom', type: 'text' },
      { key: 'officeHours', type: 'text' },
      { key: 'employeeNumber', type: 'text' },
      { key: 'appointmentDate', type: 'date' },
      { key: 'workPhone', type: 'text' },
      { key: 'researchInterests', type: 'textarea' },
      { key: 'publicationsUrl', type: 'url' },
      { key: 'responsibilities', type: 'textarea' },
      { key: 'moderationAreas', type: 'textarea' },
    ],
  },
  {
    title: 'sectionInterests',
    when: 'student',
    fields: [
      { key: 'interests', type: 'list', dict: 'interests' },
      { key: 'skills', type: 'list', dict: 'skills' },
    ],
  },
]

export function sectionVisible(when: Section['when'], role: Role): boolean {
  if (when === 'all') return true
  if (when === 'staff') return !STUDENT_ROLES.includes(role)
  if (when === 'student') return STUDENT_ROLES.includes(role)
  if (when === 'starosta') return role === Role.STAROSTA
  return false
}
