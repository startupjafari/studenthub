import { CourseView } from '../../../../views/courses'

// Страница дисциплины (Course Workspace). Идентификатор — subject (предмет), закодирован в URL.
export default async function Page({ params }: { params: Promise<{ subject: string }> }) {
  const { subject } = await params
  return <CourseView subject={decodeURIComponent(subject)} />
}
