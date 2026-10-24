import { CatalogView } from '../../../views/library-catalog'

// Каталог библиотеки у библиотекаря (Фаза 20.3).
export default function Page() {
  return <CatalogView mode="staff" basePath="/library/catalog" />
}
