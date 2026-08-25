import { PlatformDashboardView } from '../../../views/platform-admin'

// Дашборд модератора платформы: те же агрегаты, что у админа, — `/analytics/platform/*`
// разрешён обеим платформенным ролям (PLATFORM_ROLES в platform-analytics.controller).
export default function Page() {
  return <PlatformDashboardView />
}
