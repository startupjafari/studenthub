// Демо-данные. Живого API здесь нет намеренно: мини-апп пока каркас, а обращение к
// StudentHub требует проверки подписи initData на бэкенде — отдельная задача.
// Формы объектов подобраны под будущие ответы API, чтобы замена моков на fetch не
// переписывала экраны.

export interface Lesson {
  id: string
  subject: string
  teacher: string
  room: string
  startsAt: string
  endsAt: string
  kind: 'Лекция' | 'Практика' | 'Лабораторная'
  /** Ближайшая пара — её карточка подсвечена и вынесена в заголовок дня. */
  isNext?: boolean
}

export interface Assignment {
  id: string
  title: string
  subject: string
  dueLabel: string
  /** Просрочено — единственное состояние, которое красится в destructive-цвет. */
  overdue?: boolean
}

export interface Profile {
  name: string
  group: string
  faculty: string
  course: number
  gpa: number
  attendance: number
}

export const today = '14 октября, вторник'

export const lessons: Lesson[] = [
  {
    id: 'l1',
    subject: 'Дискретная математика',
    teacher: 'Абенов Д. К.',
    room: 'Ауд. 312',
    startsAt: '09:00',
    endsAt: '10:30',
    kind: 'Лекция',
  },
  {
    id: 'l2',
    subject: 'Базы данных',
    teacher: 'Сериков А. М.',
    room: 'Лаб. 204',
    startsAt: '10:45',
    endsAt: '12:15',
    kind: 'Лабораторная',
    isNext: true,
  },
  {
    id: 'l3',
    subject: 'Английский язык',
    teacher: 'Нурланова Ж. Т.',
    room: 'Ауд. 118',
    startsAt: '13:00',
    endsAt: '14:30',
    kind: 'Практика',
  },
  {
    id: 'l4',
    subject: 'Операционные системы',
    teacher: 'Ким В. С.',
    room: 'Ауд. 401',
    startsAt: '14:45',
    endsAt: '16:15',
    kind: 'Лекция',
  },
]

export const assignments: Assignment[] = [
  { id: 'a1', title: 'Лабораторная 3: индексы', subject: 'Базы данных', dueLabel: 'до завтра' },
  { id: 'a2', title: 'Эссе на 800 слов', subject: 'Английский язык', dueLabel: 'до 17 октября' },
  {
    id: 'a3',
    title: 'Задачи 4.1–4.8',
    subject: 'Дискретная математика',
    dueLabel: 'просрочено на 2 дня',
    overdue: true,
  },
]

export const profile: Profile = {
  name: 'Алишер Жумабаев',
  group: 'ИС-22-3',
  faculty: 'Информационные технологии',
  course: 3,
  gpa: 3.62,
  attendance: 94,
}
