import { cn } from '../lib/utils'

/**
 * Линия между группами пунктов меню. Та же, что у `DropdownMenuSeparator`, — для меню,
 * собранных без Radix (контекстные меню строк, сообщений, «три точки» в шапках).
 *
 * Главное её место — перед опасными пунктами. Правило для всех меню продукта: красные
 * действия (удалить, заблокировать, выйти) стоят в самом конце и отделены линией, чтобы
 * до них не доходили случайным движением вниз по списку.
 */
export function MenuSeparator({ className }: { className?: string }) {
  return <div role="separator" className={cn('my-1 h-px shrink-0 bg-border', className)} />
}

/**
 * Делит пункты меню на обычные и опасные (`danger`), не меняя порядок внутри групп.
 * Меню рисует сначала `safe`, потом — если обе группы непусты — `MenuSeparator` и `danger`.
 */
export function splitDanger<T extends { danger?: boolean }>(
  items: T[],
): { safe: T[]; danger: T[] } {
  return {
    safe: items.filter((it) => !it.danger),
    danger: items.filter((it) => it.danger),
  }
}
