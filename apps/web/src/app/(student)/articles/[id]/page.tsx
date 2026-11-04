import { ArticlePageView } from '../../../../views/article'

// Постоянная ссылка на статью: /articles/<id>. Группа (student) не добавляет сегмент в адрес,
// а её оболочка доступна всем ролям — как /posts/<id> и /profile/<id>.
export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ArticlePageView articleId={id} />
}
