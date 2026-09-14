import type { ReactNode } from 'react'
import { GraduationCap } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { MeshBrandPanel } from '../../../shared/ui'

// Публичные страницы работодателя: регистрация и подтверждение почты. Сессии здесь нет,
// поэтому ни RoleGuard, ни AppShell не подключаются. Раскладка — та же, что у входа и
// регистрации остальных ролей (`app/(auth)/layout.tsx`): слева брендовая панель с меш-сеткой,
// справа карточка по центру. Работодатель заходит на платформу впервые и по внешней ссылке,
// и вход через голый экран без бренда читается как чужая страница.
export default function Layout({ children }: { children: ReactNode }) {
  const t = useTranslations('Auth')

  return (
    <div className="flex min-h-dvh">
      <MeshBrandPanel
        title={t('brandSlogan')}
        subtitle={t('brandSubtitle')}
        copyright={t('copyright')}
      />

      {/* Мобильный: логотип у самого верха, карточка — по центру оставшегося пространства, на фоне —
          мягкая анимированная сетка точек. Десктоп: карточка по центру правой части (точки/лого скрыты). */}
      <main className="relative flex flex-1 flex-col overflow-hidden p-6">
        <div className="auth-dots lg:hidden" aria-hidden />
        <div className="relative z-10 mt-[calc(1rem+env(safe-area-inset-top))] flex items-center justify-center gap-3 lg:hidden">
          <GraduationCap className="size-9 text-primary" aria-hidden />
          <span className="text-2xl font-bold">StudentHub</span>
        </div>
        <div className="relative z-10 flex flex-1 items-center justify-center">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}
