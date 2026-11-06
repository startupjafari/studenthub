import { UniversityPageView } from '../../../../views/university-page'

export default async function UniversityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <UniversityPageView universityId={id} />
}
