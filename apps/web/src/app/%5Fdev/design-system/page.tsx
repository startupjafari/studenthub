import { DesignSystemView } from '../../../views/design-system'

// Витрина дизайн-системы — инструмент разработки, не продуктовый экран.
// Каталог назван `%5Fdev`, потому что Next исключает из роутинга папки на `_`
// (private folders); страница закрыта общим middleware — открывать залогиненным.
export default function DesignSystemPage() {
  return <DesignSystemView />
}
