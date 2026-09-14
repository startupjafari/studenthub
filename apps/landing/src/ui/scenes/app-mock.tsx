import { GraduationCap } from 'lucide-react'
import type { RoleTab } from '../../content/types'

/**
 * Макет рабочего окна платформы для выбранной роли.
 *
 * Не копия экрана и не претендует на неё: узнаваемый каркас — шапка, боковое меню,
 * рабочая область — и настоящее содержимое этой роли. Ради этого блок и существует:
 * показать, что именно видит преподаватель, а что декан.
 *
 * Раньше строки были серыми плашками. Это читалось как незагрузившийся экран, а не как
 * макет, и главный тезис секции — «каждый видит своё» — не доказывался ничем: пустые
 * полоски у всех ролей одинаковые.
 *
 * Подсвечен всегда первый пункт меню, и его же заголовок стоит в рабочей области:
 * «открыты Мои пары, показана Ведомость» — рассинхрон, который читается как ошибка.
 */
export function AppMock({ role, appName }: { role: RoleTab; appName: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-lg">
      {/* Полоса окна браузера */}
      <div className="flex items-center gap-1.5 border-b border-border bg-muted/60 px-3 py-2">
        <span className="size-2 rounded-full bg-foreground/15" />
        <span className="size-2 rounded-full bg-foreground/15" />
        <span className="size-2 rounded-full bg-foreground/15" />
      </div>

      <div className="flex">
        {/* Боковое меню — оно и меняется от роли к роли */}
        <nav className="hidden w-44 shrink-0 flex-col gap-1 border-r border-border bg-muted/30 p-3 sm:flex">
          <span className="mb-2 flex items-center gap-1.5 px-1">
            <GraduationCap className="size-4 text-primary" aria-hidden />
            <span className="text-[0.7rem] font-bold">{appName}</span>
          </span>

          {role.nav.map((item, index) => (
            <span
              key={item}
              className={[
                'sh-row-in rounded-md px-2 py-1.5 text-[0.72rem]',
                index === 0 ? 'bg-primary/10 font-medium text-primary' : 'text-foreground/60',
              ].join(' ')}
              style={{ '--i': index } as React.CSSProperties}
            >
              {item}
            </span>
          ))}
        </nav>

        {/* Рабочая область */}
        <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-4">
          <span className="text-[0.8rem] font-semibold">{role.highlight}</span>

          <ul className="flex flex-col gap-1.5">
            {role.rows.map((row, index) => (
              <li
                key={row.title}
                className={[
                  'sh-row-in flex items-center gap-3 rounded-lg border p-2.5',
                  // Первая строка выделена — так же, как выделяется текущая или срочная
                  // запись в настоящем списке.
                  index === 0 ? 'border-primary/30 bg-primary/5' : 'border-border bg-background',
                ].join(' ')}
                style={{ '--i': index + 1 } as React.CSSProperties}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.72rem] font-medium">{row.title}</span>
                  <span className="block truncate text-[0.65rem] text-foreground/55">
                    {row.meta}
                  </span>
                </span>
                <span
                  className={[
                    'shrink-0 rounded px-1.5 py-0.5 text-[0.65rem] font-semibold tabular-nums',
                    index === 0 ? 'bg-primary/15 text-primary' : 'bg-muted text-foreground/70',
                  ].join(' ')}
                >
                  {row.value}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
