import { StudentApplicationsView } from '../../../../widgets/applications'

// Диплинк на заявку: сюда ведут уведомления и пуши о смене статуса (`/applications/<id>`).
// Отдельного экрана нет — список заявок открывается с этой заявкой окном поверх.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <StudentApplicationsView initialId={id} />
}
