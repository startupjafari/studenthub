export interface MaterialFile {
  id: string
  // Исходное имя файла; у загруженных до его сохранения — null.
  name: string | null
  mime: string
  size: number
  createdAt: string
}

export interface Material {
  id: string
  groupId: string
  subject: string | null
  title: string
  description: string | null
  url: string | null
  createdAt: string
  teacher: { id: string; firstName: string; lastName: string }
  media: MaterialFile[]
}

/** Счётчик материалов дисциплины (`GET /materials/subjects`); `null` — без дисциплины. */
export interface MaterialSubjectCount {
  subject: string | null
  count: number
}
