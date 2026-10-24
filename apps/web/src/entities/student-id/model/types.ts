import type { EntryDecision } from '@studenthub/shared-schemas'

// Данные карты (общие для «моей» карты и результата верификации).
export interface StudentIdCard {
  id: string
  firstName: string
  lastName: string
  middleName: string | null
  avatarUrl: string | null
  role: string
  studentCardNumber: string | null
  academicStatus: string | null
  educationLevel: string | null
  studyForm: string | null
  specialty: string | null
  fundingType: string | null
  dormitory: string | null
  // ISO-строка: формат даты выбирает клиент по локали.
  birthDate: string | null
  course: number | null
  enrollmentYear: number | null
  graduationYear: number | null
  group: string | null
  faculty: string | null
  university: string | null
  universityShort: string | null
}

export interface MyStudentId extends StudentIdCard {
  token: string
  qr: string // data:image/png dataURL
  expiresAt: string
  ttlSeconds: number
}

export interface VerifiedStudentId extends StudentIdCard {
  valid: boolean
  verifiedAt: string
  // Поля ответа, заполненные студентом самим, а не вузом (сейчас — дата рождения): на карте
  // помечаются «со слов студента». Необязательное — старый сервер поле не присылал.
  selfDeclared?: string[]
  // Решение о проходе — только охране (пост, docs/PROJECT.md §3.12): карта может быть
  // настоящей, а пропускать по ней нельзя (отчислен, выпускник, переведён).
  entry?: EntryDecision
}
