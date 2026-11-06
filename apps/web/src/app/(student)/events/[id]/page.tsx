import { EventDetailView } from '../../../../views/events'

// Карточка события (§3.5): сюда ведут уведомления и пуши о событии и название в списке.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <EventDetailView eventId={id} />
}
