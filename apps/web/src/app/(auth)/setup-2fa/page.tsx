import { SetupTwoFactorGate } from '../../../features/setup-2fa'

// Экран обязательной настройки 2FA для привилегированных ролей. Standalone (auth-лейаут,
// без оболочки приложения) — пользователь уже вошёл, но форс закрывает остальной API до 2FA.
export default function SetupTwoFactorPage() {
  return <SetupTwoFactorGate />
}
