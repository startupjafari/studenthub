import { CampusEditorView } from '../../../views/campus-editor'

export default async function Page({ params }: { params: Promise<{ floorId: string }> }) {
  const { floorId } = await params
  return <CampusEditorView floorId={floorId} />
}
