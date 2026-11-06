import { CampusViewerView } from '../../../../views/campus-viewer'

export default async function Page({ params }: { params: Promise<{ campusId: string }> }) {
  const { campusId } = await params
  return <CampusViewerView campusId={campusId} />
}
