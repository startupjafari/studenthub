// Статические справочники-перечисления профиля для Select-полей (выбор + свой ввод).

import { ACADEMIC_STATUSES } from '@studenthub/shared-types'

export const EDUCATION_LEVEL_DICT: string[] = [
  'Среднее',
  'Среднее специальное',
  'Бакалавриат',
  'Специалитет',
  'Магистратура',
  'Аспирантура',
  'Докторантура',
]

export const STUDY_FORM_DICT: string[] = ['Очная', 'Заочная', 'Очно-заочная', 'Дистанционная']

export const FUNDING_TYPE_DICT: string[] = ['Бюджетное', 'Платное', 'Грант', 'Целевое']

// Закрытый справочник — общий с api (`AcademicStatus` в shared-types): из него же api решает,
// кому закрыта выдача книг и вход на пост.
export const ACADEMIC_STATUS_DICT: string[] = [...ACADEMIC_STATUSES]

export const DORMITORY_DICT: string[] = ['Да', 'Нет']

// Часовые пояса — смещения UTC (−12…+14). Нестандартные (получасовые) — свой ввод.
export const TIMEZONE_DICT: string[] = Array.from({ length: 27 }, (_, i) => {
  const off = i - 12
  return `UTC${off >= 0 ? '+' : '−'}${Math.abs(off)}`
})

// Года для Select (текущий год + запас вперёд, назад до 1970). Год хранится как число.
export function yearOptions(): string[] {
  const now = new Date().getFullYear()
  const years: string[] = []
  for (let y = now + 6; y >= 1970; y--) years.push(String(y))
  return years
}
