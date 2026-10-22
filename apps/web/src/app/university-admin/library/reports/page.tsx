import { ReportsView } from '../../../../views/library-reports'
import { LibraryAdminTabs } from '../../../../views/library-admin'

// Отчёты библиотеки у админа вуза — вкладка раздела «Библиотека» (Фаза 20.12).
export default function Page() {
  return (
    <ReportsView
      headerTabs={<LibraryAdminTabs />}
      catalogHref="/university-admin/library/catalog"
    />
  )
}
