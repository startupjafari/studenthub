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
}
