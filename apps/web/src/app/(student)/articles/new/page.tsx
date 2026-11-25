import { ArticleEditorView } from '../../../../views/article-editor'

// Новая статья: /articles/new, от имени страницы организации — ?as=company|university
// (организацию сервер берёт из токена, параметр лишь выбирает, от чьего имени).
export default async function NewArticlePage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>
}) {
  const { as } = await searchParams
  return <ArticleEditorView as={as === 'company' || as === 'university' ? as : 'user'} />
}
