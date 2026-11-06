import { StoryLinkView } from '../../../../views/story-link'

// Сторис по ссылке (§3.4): открывается в обычном окне просмотра поверх оболочки.
export default async function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <StoryLinkView id={id} />
}
