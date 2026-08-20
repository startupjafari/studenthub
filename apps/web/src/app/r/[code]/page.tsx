import { RoomStatusView } from '../../../views/rooms'

// Цель печатного QR помещения (Ф16): короткий путь /r/<код> — он попадает в QR,
// поэтому чем короче, тем менее плотный код и тем легче он сканируется.
// Страница закрыта авторизацией (middleware): расписание группы — внутренние данные вуза,
// а наклейка висит в открытом коридоре.
export default async function RoomByCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return <RoomStatusView code={code} />
}
