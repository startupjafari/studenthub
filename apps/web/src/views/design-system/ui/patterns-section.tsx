'use client'

import { useState } from 'react'
import { AlertTriangle, ChevronRight, FileText, GraduationCap, Inbox, Users } from 'lucide-react'

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  Progress,
  Skeleton,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { Caption, Code, Demo, Pitfall, Section } from './kit'

// Композиционные паттерны (docs/DESIGN_SYSTEM.md §10) — сборки, из которых состоит
// почти каждый экран платформы. Новый экран начинается с выбора паттерна.

const ROWS = [
  {
    id: '1',
    icon: FileText,
    title: 'Справка об обучении',
    meta: 'SH-2481 · подана 12 августа',
    badge: { label: 'В работе', variant: 'info' as const },
    warn: false,
  },
  {
    id: '2',
    icon: FileText,
    title: 'Транскрипт оценок',
    meta: 'SH-2477 · нужен скан удостоверения',
    badge: { label: 'Нужна правка', variant: 'warning' as const },
    warn: true,
  },
  {
    id: '3',
    icon: GraduationCap,
    title: 'Академическая справка',
    meta: 'SH-2455 · выдана 3 августа',
    badge: { label: 'Выдана', variant: 'success' as const },
    warn: false,
  },
]

/** Строка настройки — идиом панели настроек (§10.6). */
function SettingRow({
  title,
  desc,
  children,
}: {
  title: string
  desc?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-4 border-b border-border py-3.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/** Переключатель настройки: role="switch" + aria-checked, а не стилизованный чекбокс. */
function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-4 focus-visible:ring-ring/25',
        checked ? 'bg-primary' : 'bg-muted',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 size-5 rounded-full bg-background ring-1 ring-border transition-transform motion-reduce:transition-none',
          checked && 'translate-x-5',
        )}
      />
    </button>
  )
}

export function PatternsSection() {
  const [notify, setNotify] = useState(true)
  const [digest, setDigest] = useState(false)

  return (
    <div className="flex flex-col gap-10">
      <Section
        id="row-card"
        title="Строка списка (row-card)"
        note="Основной идиом продукта: заявки, факультеты, материалы, группы. Список — flex flex-col gap-2, строка — Card с flex-row."
      >
        <Demo label="Список" className="block">
          <div className="flex flex-col gap-2">
            {ROWS.map((row) => {
              const Icon = row.icon
              return (
                <Card
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  className="flex-row items-center gap-3 p-4 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <span
                    className={cn(
                      'flex size-10 shrink-0 items-center justify-center rounded-lg',
                      row.warn ? 'bg-warning/15 text-warning' : 'bg-primary/10 text-primary',
                    )}
                  >
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate font-medium">{row.title}</span>
                    <span className="truncate text-xs text-muted-foreground">{row.meta}</span>
                    {row.warn && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-warning">
                        <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                        Требуется действие
                      </span>
                    )}
                  </div>
                  <Badge variant={row.badge.variant}>{row.badge.label}</Badge>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                </Card>
              )
            })}
          </div>
        </Demo>

        <Pitfall>
          <Code>flex-row</Code> обязателен: <Code>Card</Code> внутри — <Code>flex-col</Code>, и
          передать только <Code>flex items-center</Code> недостаточно. <Code>tailwind-merge</Code>{' '}
          считает <Code>flex</Code> и <Code>flex-col</Code> разными группами и колонку не снимает —
          карточка соберётся в вертикальный столбик.
        </Pitfall>
        <Caption>
          Шеврон справа означает переход. Нет перехода — нет шеврона. Кнопка внутри кликабельной
          строки требует stopPropagation.
        </Caption>
      </Section>

      <Section
        id="states"
        title="Три состояния асинхронной области"
        note="Порядок ветвления одинаков везде: loading → error → empty → данные. Область без всех трёх видов считается незаконченной."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Caption>loading</Caption>
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => (
                <Card key={i} className="flex-row items-center gap-3 p-4">
                  <Skeleton className="size-10 shrink-0 rounded-lg" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </Card>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Caption>error</Caption>
            <EmptyState
              icon={<AlertTriangle className="size-6" aria-hidden />}
              title="Не удалось загрузить заявки"
              description="Проверьте соединение и попробуйте снова."
              action={
                <Button size="sm" variant="outline">
                  Повторить
                </Button>
              }
            />
          </div>

          <div className="flex flex-col gap-2">
            <Caption>empty</Caption>
            <EmptyState
              icon={<Inbox className="size-6" aria-hidden />}
              title="Заявок пока нет"
              description="Создайте первую — она появится здесь."
              action={<Button size="sm">Создать заявку</Button>}
            />
          </div>
        </div>
      </Section>

      <Section
        id="form"
        title="Форма"
        note="Ошибка поля — под полем, ошибка сервера — FormAlert сверху. Кнопка отправки на время запроса переходит в loading, а не в disabled без объяснения."
      >
        <Demo label="Раскладка" className="block">
          <form className="flex max-w-md flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ds-form-name">Тема обращения</Label>
              <Input id="ds-form-name" placeholder="Например, перевод на другой факультет" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ds-form-mail">Почта университета</Label>
              <Input id="ds-form-mail" aria-invalid defaultValue="student@" />
              <span className="text-xs text-destructive">Укажите почту в домене университета</span>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost">
                Отмена
              </Button>
              <Button type="submit">Отправить</Button>
            </div>
          </form>
        </Demo>
      </Section>

      <Section
        id="settings"
        title="Панель настроек"
        note="Строки внутри одной карточки, разделённые линией. Отдельная карточка на каждую настройку — не наш язык."
      >
        <Demo label="SettingRow" className="block">
          <Card className="max-w-xl px-4 py-1">
            <SettingRow title="Уведомления о заявках" desc="Письмо при смене статуса">
              <ToggleSwitch checked={notify} onChange={setNotify} label="Уведомления о заявках" />
            </SettingRow>
            <SettingRow title="Дайджест за неделю" desc="Сводка по понедельникам">
              <ToggleSwitch checked={digest} onChange={setDigest} label="Дайджест за неделю" />
            </SettingRow>
            <SettingRow title="Язык интерфейса">
              <Caption>Русский</Caption>
            </SettingRow>
          </Card>
        </Demo>
        <Caption>
          Системного <Code>Switch</Code> в shared/ui пока нет — реализация приватно живёт в
          настройках аккаунта. Второе применение = повод поднять компонент в shared/ui.
        </Caption>
      </Section>

      <Section
        id="tiles"
        title="Плитка показателя"
        note="Числовая сводка дашборда. Плитка некликабельна, поэтому отклик на наведение — только граница: подъём обещал бы переход."
      >
        <Demo label="Сводка" className="block">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Студентов', value: '4 128', hint: 'активных за месяц' },
              { label: 'Заявок в работе', value: '312', delta: '+8% к июлю', good: true },
              { label: 'Просрочено', value: '7', delta: '+3 за неделю', good: false },
              { label: 'Средний срок', value: '2,4 дн', hint: 'по всем услугам' },
            ].map((tile) => (
              <div
                key={tile.label}
                className="flex flex-col gap-1.5 rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-colors hover:ring-ring/50"
              >
                <span className="text-xs text-muted-foreground">{tile.label}</span>
                <span className="text-2xl leading-none font-semibold">{tile.value}</span>
                <span className="text-xs text-muted-foreground">
                  {tile.delta ? (
                    <span className={tile.good ? 'text-success' : 'text-destructive'}>
                      {tile.delta}
                    </span>
                  ) : (
                    tile.hint
                  )}
                </span>
              </div>
            ))}
          </div>
        </Demo>

        <Demo label="Прогресс в строке" className="block">
          <Card className="max-w-xl flex-row items-center gap-4 p-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Users className="size-5" aria-hidden />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-medium">Посещаемость группы ИТ-21</span>
                <span className="text-xs tabular-nums text-muted-foreground">86%</span>
              </div>
              <Progress value={86} />
            </div>
          </Card>
        </Demo>
      </Section>
    </div>
  )
}
