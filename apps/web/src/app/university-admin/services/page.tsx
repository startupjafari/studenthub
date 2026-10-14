import { ServiceCatalogView } from '../../../views/service-catalog'

// Каталог услуг (docs/PROJECT.md §3.2): у админа вуза — услуги вуза и шаблоны платформы,
// у админа платформы — сами шаблоны. Права проверяет сервер (ApplicationPolicy).
export default function Page() {
  return <ServiceCatalogView />
}
