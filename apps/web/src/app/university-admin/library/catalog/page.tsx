import { CatalogView } from '../../../../views/library-catalog'
import { LibraryAdminTabs } from '../../../../views/library-admin'

// Каталог библиотеки у админа вуза — вкладка раздела «Библиотека» (Фаза 20.3).
export default function Page() {
  return (
    <CatalogView
      mode="staff"
      basePath="/university-admin/library/catalog"
      headerTabs={<LibraryAdminTabs />}
    />
  )
}
