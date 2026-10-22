import { CatalogView } from '../../../views/library-catalog'
import { LibraryReaderTabs } from '../../../views/library-reader'

// Каталог библиотеки у студента и старосты: поиск, наличие, бронь (Фаза 20.9).
export default function Page() {
  return <CatalogView mode="reader" basePath="/books" headerTabs={<LibraryReaderTabs />} />
}
