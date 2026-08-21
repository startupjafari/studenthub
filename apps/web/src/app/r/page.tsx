import { RoomCodeEntryView } from '../../views/rooms'

// Ф16: ручной ввод кода помещения — запасной путь, если печатный QR повреждён.
// Как и /r/<код>, страница закрыта авторизацией (middleware): статус помещения —
// внутренние данные вуза.
export default function RoomCodeEntryPage() {
  return <RoomCodeEntryView />
}
