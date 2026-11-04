import { RoomLocationView } from '../../../../../views/campus-viewer'

export default async function Page({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params
  return <RoomLocationView roomId={roomId} />
}
