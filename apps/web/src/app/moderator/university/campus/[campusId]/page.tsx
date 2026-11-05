import { CampusDetailView } from '../../../../../views/campus-admin'

export default async function CampusDetailPage({
  params,
}: {
  params: Promise<{ campusId: string }>
}) {
  const { campusId } = await params
  return <CampusDetailView campusId={campusId} basePath="/moderator/university/campus" />
}
