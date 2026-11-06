import { SectionFallback } from '../../../views/role-landing'

// Адрес в зоне роли без своей страницы: раздел из навигации — заглушка, остальное — 404.
export default async function Page({ params }: { params: Promise<{ section: string[] }> }) {
  const { section } = await params
  return <SectionFallback variant="starosta" base="/starosta" section={section} />
}
