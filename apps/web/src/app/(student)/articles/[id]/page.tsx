import { ArticleLinkView } from '../../../../views/article'

// Постоянная ссылка на статью: /articles/<id>. Своей страницы у статьи нет — ссылка
// открывает её окном на странице владельца (views/article).
export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ArticleLinkView articleId={id} />
}
