import { ReportsView } from '../../../../views/library-reports'

// Отчёты библиотеки у админа вуза — страница раздела «Библиотека» в навигации (Фаза 20.12).
export default function Page() {
  return <ReportsView catalogHref="/university-admin/library/catalog" />
}
