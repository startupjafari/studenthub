import { ArticleEditorView } from '../../../../../views/article-editor'

// Правка статьи: /articles/<id>/edit. Право на правку проверяет сервер при сохранении.
export default async function EditArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ArticleEditorView articleId={id} />
}
