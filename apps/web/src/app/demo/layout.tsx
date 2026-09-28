import type { ReactNode } from 'react'
import { GraduationCap } from 'lucide-react'

// Заявка вуза на тестирование: сессии здесь нет, поэтому ни RoleGuard, ни AppShell не
// подключаются — только карточка по центру, как на публичных страницах работодателя.
// Шире их (2xl против md): в форме есть парные поля, и на 28rem они складываются в
// столбец даже на десктопе.
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6">
      <div className="flex items-center gap-2">
        <GraduationCap className="size-7 text-primary" aria-hidden />
        <span className="text-xl font-bold">StudentHub</span>
      </div>
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        {children}
      </div>
    </main>
  )
}
