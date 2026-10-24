import { CopyCodeView } from '../../../views/library-copy'

// QR-наклейка экземпляра книги (Фаза 20.3): ведёт к книге — в фонд или в каталог.
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return <CopyCodeView code={code} />
}
