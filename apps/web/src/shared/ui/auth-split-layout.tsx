import type { ReactNode } from 'react'
import { GraduationCap } from 'lucide-react'
import { cn } from '../lib/utils'
import { MeshBrandPanel } from './mesh-brand-panel'

export interface AuthSplitLayoutProps {
  /** Текст брендовой панели — свой у входа, заявки вуза и работодателя. */
  title: string
  subtitle: string
  copyright: string
  /** Ширина карточки: `xl` — для форм с парными полями, на `md` они складываются в столбец. */
  width?: 'md' | 'xl'
  children: ReactNode
}

/**
 * Split-экран без сессии: вход, регистрация, заявка вуза, регистрация работодателя.
 * Слева брендовая панель (скрыта на мобильном), справа — форма в карточке.
 *
 * Экран полноэкранный и сам не прокручивается: панель стоит на месте всегда, а длинная
 * форма (регистрация, заявка) прокручивается внутри правой колонки. Раньше уезжала вся
 * страница вместе с панелью, и под ней открывалась пустая полоса.
 *
 * Форма короче экрана — по центру колонки; длиннее — от верха с отступами, а не
 * центрированием: отцентрированная, она уходила бы первым полем под верхний край.
 */
export function AuthSplitLayout({
  title,
  subtitle,
  copyright,
  width = 'md',
  children,
}: AuthSplitLayoutProps) {
  return (
    <div className="flex h-dvh overflow-hidden">
      <MeshBrandPanel title={title} subtitle={subtitle} copyright={copyright} />

      {/* Сетка точек (мобильный) лежит на неподвижном `main`, а прокручивается слой над ней —
          точки не уезжают вместе с формой. */}
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="auth-dots lg:hidden" aria-hidden />
        <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain p-6">
          <div className="mt-[calc(1rem+env(safe-area-inset-top))] flex items-center justify-center gap-3 lg:hidden">
            <GraduationCap className="size-9 text-primary" aria-hidden />
            <span className="text-2xl font-bold">StudentHub</span>
          </div>
          <div className="flex flex-1 items-center justify-center py-6 lg:py-10">
            <div
              className={cn(
                'w-full rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8',
                width === 'xl' ? 'max-w-xl' : 'max-w-md',
              )}
            >
              {children}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
