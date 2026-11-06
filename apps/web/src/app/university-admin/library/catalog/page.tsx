import { CatalogView } from '../../../../views/library-catalog'

// Каталог библиотеки у админа вуза — страница раздела «Библиотека» в навигации (Фаза 20.3).
export default function Page() {
  return <CatalogView mode="staff" basePath="/university-admin/library/catalog" />
}
