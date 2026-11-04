import { SiteEditorView } from '../../../../views/campus-site-editor'

export default async function Page({ params }: { params: Promise<{ campusId: string }> }) {
  const { campusId } = await params
  return <SiteEditorView campusId={campusId} />
}
