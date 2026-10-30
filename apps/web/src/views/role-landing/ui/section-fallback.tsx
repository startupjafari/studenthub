import { notFound } from 'next/navigation'
import type { NavVariant } from '../../../widgets/app-shell'
import { isPlannedSection } from '../lib/planned-section'
import { SectionStub } from './section-stub'

/**
 * Неизвестный адрес внутри зоны роли: заглушка для раздела из навигации без своей
 * страницы, для всего остального — 404 (см. isPlannedSection).
 */
export function SectionFallback({
  variant,
  base,
  section,
}: {
  variant: NavVariant
  /** Корень зоны роли — `/dean`, `/moderator/platform`. */
  base: string
  section: string[]
}) {
  if (!isPlannedSection(variant, `${base}/${section.join('/')}`)) notFound()
  return <SectionStub />
}
