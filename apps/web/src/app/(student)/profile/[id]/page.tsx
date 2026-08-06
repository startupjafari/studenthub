import { PublicUserProfile } from '../../../../widgets/user-profile'

export default async function PublicProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <PublicUserProfile userId={id} />
}
