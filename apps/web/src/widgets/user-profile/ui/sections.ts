import { Role } from '@studenthub/shared-types'
import { profileFieldAllowed, type ProfileFieldKey } from '@studenthub/shared-schemas'

// Конфиг секций/полей профиля (data-driven). Порядок = порядок отображения.
// Используется и в режиме просмотра, и в форме редактирования — единый источник истины.
//
// Видимость полей по роли живёт НЕ здесь, а в PROFILE_FIELD_ROLES (@studenthub/shared-schemas):
// та же карта фильтрует запись на бэке, поэтому UI и валидация не могут разойтись.
// Здесь — только группировка, порядок и тип виджета.

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
  key: ProfileFieldKey
  type: FieldType
  dict?: DictKind
}

export interface Section {
  title: string // i18n-ключ (Profile namespace)
  fields: FieldDef[]
}

export const SECTIONS: Section[] = [
  {
    title: 'sectionAbout',
    fields: [{ key: 'bio', type: 'textarea' }],
  },
  {
    title: 'sectionContacts',
    fields: [
      { key: 'phone', type: 'phone' },
      { key: 'telegram', type: 'telegram' },
      { key: 'instagram', type: 'instagram' },
      { key: 'website', type: 'url' },
    ],
  },
  {
    title: 'sectionPersonal',
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
    fields: [{ key: 'duties', type: 'textarea' }],
  },
  // Академический блок: кафедра, степень, предметы. Только преподаватель и декан —
  // у административных и платформенных ролей этих сущностей не существует.
  {
    title: 'sectionAcademic',
    fields: [
      { key: 'academicDegree', type: 'text' },
      { key: 'academicTitle', type: 'text' },
      { key: 'department', type: 'text' },
      { key: 'subjects', type: 'list' },
      { key: 'officeHours', type: 'text' },
      { key: 'researchInterests', type: 'textarea' },
      { key: 'publicationsUrl', type: 'url' },
    ],
  },
  // Служебный блок. Для платформенных ролей от него остаётся минимум:
  // должность, рабочий телефон, зона ответственности (+ модерация у модератора).
  {
    title: 'sectionWork',
    fields: [
      { key: 'position', type: 'text' },
      { key: 'jobTitle', type: 'text' },
      { key: 'employeeNumber', type: 'text' },
      { key: 'appointmentDate', type: 'date' },
      { key: 'officeRoom', type: 'text' },
      { key: 'workPhone', type: 'text' },
      { key: 'responsibilities', type: 'textarea' },
      { key: 'moderationAreas', type: 'textarea' },
    ],
  },
  {
    title: 'sectionInterests',
    fields: [
      { key: 'interests', type: 'list', dict: 'interests' },
      { key: 'skills', type: 'list', dict: 'skills' },
    ],
  },
]

/**
 * Секции с полями, доступными роли. Секция без полей отбрасывается целиком —
 * так у платформенного администратора не остаётся пустых карточек, которые
 * нечем заполнить (например «Академическое»).
 */
export function visibleSections(role: Role): Section[] {
  return SECTIONS.map((s) => ({
    ...s,
    fields: s.fields.filter((f) => profileFieldAllowed(f.key, role)),
  })).filter((s) => s.fields.length > 0)
}

/** Доступно ли роли конкретное поле профиля (для карточек вне SECTIONS: навыки/интересы). */
export function fieldVisible(key: ProfileFieldKey, role: Role): boolean {
  return profileFieldAllowed(key, role)
}
