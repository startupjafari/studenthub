import { GraduationCap } from 'lucide-react'
import type { RoleTab } from '../../content/types'

/**
 * Макет рабочего окна платформы для выбранной роли.
 *
 * Не копия экрана и не претендует на неё: узнаваемый каркас — шапка, боковое меню,
 * рабочая область — и настоящие названия разделов этой роли. Ради меню блок и
 * существует: видно, что у преподавателя и у декана разные разделы, а не разный текст
 * про одни и те же.
 *
 * Строки содержимого — полоски, и это решение, а не заглушка. Ведомость с фамилиями и
 * оценками пришлось бы выдумать целиком: настоящих студентов на публичной странице быть
 * не может, а придуманные — это данные, которых не существует, показанные как
 * существующие. Полоска честно говорит «здесь список», и ничего сверх этого не обещает.
 *
 * Подсвечен всегда первый пункт меню, и его же заголовок стоит в рабочей области:
 * «открыты Мои пары, показана Ведомость» — рассинхрон, который читается как ошибка.
 */

/**
 * Ширины полосок. Заданы списком, а не случайным числом: макет рендерится на сервере,
 * и `Math.random()` дал бы разную разметку на сервере и на клиенте — ошибку гидрации.
 * Неровные края при этом обязательны: одинаковые полоски читаются как таблица загрузки.
 */
const ROWS = ['72%', '56%', '84%', '48%']

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

          {/* aria-hidden: читать здесь нечего — полоски не текст, а обозначение списка.
              Название открытого раздела выше уже сказало всё, что этот блок сообщает. */}
          <div aria-hidden className="flex flex-col gap-1.5">
            {ROWS.map((width, index) => (
              <span
                key={width}
                className={[
                  'sh-row-in flex items-center gap-3 rounded-lg border p-2.5',
                  // Первая строка выделена — так же, как выделяется текущая или срочная
                  // запись в настоящем списке.
                  index === 0 ? 'border-primary/30 bg-primary/5' : 'border-border bg-background',
                ].join(' ')}
                style={{ '--i': index + 1 } as React.CSSProperties}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span
                    className={[
                      'block h-1.5 rounded-full',
                      index === 0 ? 'bg-primary/35' : 'bg-foreground/15',
                    ].join(' ')}
                    style={{ width }}
                  />
                  <span className="block h-1.5 w-[38%] rounded-full bg-foreground/10" />
                </span>
                <span
                  className={[
                    'h-3.5 w-8 shrink-0 rounded',
                    index === 0 ? 'bg-primary/20' : 'bg-muted',
                  ].join(' ')}
                />
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
