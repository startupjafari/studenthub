import { PlatformDashboard } from '../../../widgets/platform-dashboard'

// Дашборд платформенного администратора: показатели и графики.
// Шапку страницы рисует сам виджет — в ней же живёт переключатель периода,
// а он завязан на клиентское состояние. Плиток-ссылок на разделы здесь нет —
// они дублировали сайдбар.
export function PlatformDashboardView() {
  return <PlatformDashboard />
}
