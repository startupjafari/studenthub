import { ReportsView } from '../../../views/library-reports'

// Отчёты библиотеки у библиотекаря (Фаза 20.12).
export default function Page() {
  return <ReportsView loansHref="/library/loans" catalogHref="/library/catalog" />
}
