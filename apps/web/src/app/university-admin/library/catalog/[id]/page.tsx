import { BookDetailView } from '../../../../../views/library-catalog'

// Книга с экземплярами у админа вуза (Фаза 20.3).
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <BookDetailView bookId={id} basePath="/university-admin/library/catalog" />
}
