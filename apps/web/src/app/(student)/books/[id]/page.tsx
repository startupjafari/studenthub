import { ReaderBookView } from '../../../../views/library-reader'

// Книга глазами читателя: наличие и бронь (Фаза 20.9).
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ReaderBookView bookId={id} />
}
