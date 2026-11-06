import { PublicProfileView } from '../../../../views/profile'

export default async function PublicProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <PublicProfileView userId={id} />
}
