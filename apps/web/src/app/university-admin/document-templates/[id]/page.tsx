import { TemplateDetailView } from '../../../../views/document-templates'

// Карточка шаблона документа: версии, проверка, публикация, документ для студента.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <TemplateDetailView templateId={id} />
}
