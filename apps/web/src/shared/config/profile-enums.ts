// Статические справочники-перечисления профиля для Select-полей (выбор + свой ввод).

export const MARITAL_STATUS_DICT: string[] = [
  'Холост / Не замужем',
  'В отношениях',
  'Помолвлен(а)',
  'Женат / Замужем',
  'В гражданском браке',
  'В разводе',
  'Вдовец / Вдова',
]

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

export const ACADEMIC_STATUS_DICT: string[] = [
  'Обучающийся',
  'Академический отпуск',
  'Выпускник',
  'Отчислен',
  'Переведён',
]

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
