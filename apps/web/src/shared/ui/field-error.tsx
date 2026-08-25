import type { ReactNode } from 'react'

import { cn } from 'shared/lib/utils'

// Ошибка поля — строка под самим полем (DESIGN_SYSTEM §10.3), а не тост и не баннер:
// пользователь читает её там, где исправляет. `role="alert"` обязателен, иначе
// скринридер не объявит появившийся текст. Пустое значение ничего не рисует, поэтому
// вызов можно ставить безусловно: <FieldError>{errors.title}</FieldError>.
export function FieldError({ children, className }: { children?: ReactNode; className?: string }) {
  if (!children) return null
  return (
    <p role="alert" className={cn('text-xs text-destructive', className)}>
      {children}
    </p>
  )
}
