export interface MaterialFile {
  id: string
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
