import { Bell, ChevronRight, FileText, Inbox, Search } from 'lucide-react'

import { BRAND_GRADIENT } from '../../../shared/config'
import { IDENTITY_COLORS, identityInitials } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { Caption, Code, Demo, Pitfall, Section, Swatch } from './kit'

// Основания системы: цвет, типографика, пространство, форма, слои, иконки, движение.
// Значения не продублированы вручную — каждый образец нарисован тем же классом,
// который предлагается копировать.

const SURFACES = [
  { token: 'background', className: 'bg-background', note: 'фон документа' },
  { token: 'card', className: 'bg-card', note: 'поверхность контента' },
  { token: 'popover', className: 'bg-popover', note: 'парящий слой' },
  { token: 'sidebar', className: 'bg-sidebar', note: 'навигация и шапка' },
  { token: 'muted', className: 'bg-muted', note: 'приглушённая подложка' },
  { token: 'accent', className: 'bg-accent', note: 'наведение в меню' },
]

const ACTIONS = [
  { token: 'primary', className: 'bg-primary', note: 'брендовое действие' },
  { token: 'secondary', className: 'bg-secondary', note: 'спокойное действие' },
  { token: 'destructive', className: 'bg-destructive', note: 'необратимое' },
  { token: 'ring', className: 'bg-ring', note: 'фокус' },
  { token: 'border', className: 'bg-border', note: 'разделитель' },
  { token: 'input', className: 'bg-input', note: 'граница поля' },
]

const STATUSES = [
  { token: 'success', className: 'bg-success' },
  { token: 'warning', className: 'bg-warning' },
  { token: 'info', className: 'bg-info' },
  { token: 'destructive', className: 'bg-destructive' },
]

const STATUS_FILLS = [
  { label: 'Принято', className: 'bg-success/10 text-success' },
  { label: 'Требует правки', className: 'bg-warning/15 text-warning' },
  { label: 'На проверке', className: 'bg-info/10 text-info' },
  { label: 'Отклонено', className: 'bg-destructive/10 text-destructive' },
  { label: 'Черновик', className: 'bg-muted text-muted-foreground' },
]

const CHARTS = ['bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5']

const TYPE_SCALE = [
  { role: 'Заголовок страницы', cls: 'text-lg font-bold', where: 'только PageHeader' },
  { role: 'Заголовок диалога', cls: 'text-base font-semibold', where: 'Modal, шапки панелей' },
  { role: 'Заголовок карточки', cls: 'text-base font-medium', where: 'CardTitle' },
  { role: 'Основной текст', cls: 'text-sm', where: 'тело, строки, поля' },
  { role: 'Вторичный / мета', cls: 'text-xs text-muted-foreground', where: 'даты, подписи' },
  { role: 'Крупное число', cls: 'text-2xl font-semibold leading-none', where: 'KPI, метр' },
]

const SPACING = [
  { cls: 'gap-1', px: '4px', role: 'внутри бейджа' },
  { cls: 'gap-1.5', px: '6px', role: 'иконка + текст' },
  { cls: 'gap-2', px: '8px', role: 'однородные элементы, строки списка' },
  { cls: 'gap-3', px: '12px', role: 'блоки внутри карточки' },
  { cls: 'gap-4', px: '16px', role: 'группы, поля формы' },
  { cls: 'gap-6', px: '24px', role: 'секции страницы' },
]

const RADII = [
  { cls: 'rounded-md', role: 'чекбокс, скелетон' },
  { cls: 'rounded-lg', role: 'вложенное в контрол' },
  { cls: 'rounded-xl', role: 'контролы и поверхности' },
  { cls: 'rounded-2xl', role: 'модалка, нижний лист' },
  { cls: 'rounded-full', role: 'аватар, бейдж, трек' },
]

const LAYERS = [
  { z: 'z-10…z-30', role: 'липкая шапка таблицы, закреплённая колонка' },
  { z: 'z-40', role: 'нижняя навигация' },
  { z: 'z-50', role: 'полноэкранные мобильные поверхности' },
  { z: 'z-[100]', role: 'модалки, диалоги, лайтбокс' },
  { z: 'z-[110]', role: 'поповер, открытый из модалки' },
  { z: 'z-[190]', role: 'Sheet' },
  { z: 'z-[200]', role: 'Select, DropdownMenu' },
  { z: 'z-[300]', role: 'Tooltip, командная палитра' },
]

const ICONS = [
  { cls: 'size-3.5', Icon: Search, role: 'в мелкой кнопке' },
  { cls: 'size-4', Icon: Bell, role: 'основной размер' },
  { cls: 'size-5', Icon: ChevronRight, role: 'строка списка, навигация' },
  { cls: 'size-6', Icon: FileText, role: 'заголовок блока' },
  { cls: 'size-8', Icon: Inbox, role: 'пустое состояние' },
]

const DURATIONS = [
  { cls: 'duration-150', role: 'отклик: наведение, нажатие' },
  { cls: 'duration-200', role: 'появление парящего слоя' },
  { cls: 'duration-300', role: 'смена поверхности' },
  { cls: 'duration-500', role: 'оживление данных' },
]

export function FoundationsSection() {
  return (
    <div className="flex flex-col gap-10">
      <Section
        id="color"
        title="Цвет"
        note="Единственный источник — переменные globals.css. Сырая палитра Tailwind (bg-amber-500) и hex в разметке запрещены: в тёмной теме они не переключаются."
      >
        <Demo label="Поверхности" rule="в светлой теме background и card совпадают — это норма">
          {SURFACES.map((s) => (
            <Swatch key={s.token} {...s} />
          ))}
        </Demo>

        <Demo label="Действия и границы">
          {ACTIONS.map((s) => (
            <Swatch key={s.token} {...s} />
          ))}
        </Demo>

        <Demo label="Статусы" rule="насыщенный тон — только для акцентов и полос">
          {STATUSES.map((s) => (
            <Swatch key={s.token} {...s} />
          ))}
        </Demo>

        <Demo
          label="Статусные подложки"
          rule="рабочая форма статуса: заливка токена с прозрачностью + текст тем же токеном"
        >
          {STATUS_FILLS.map((s) => (
            <span
              key={s.label}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${s.className}`}
            >
              {s.label}
            </span>
          ))}
        </Demo>

        <Demo label="Цвет текста">
          <span className="text-sm text-foreground">foreground — основной</span>
          <span className="text-sm text-muted-foreground">muted-foreground — вторичный</span>
          <span className="text-sm text-primary">primary — ссылка и активное</span>
          <span className="text-sm text-destructive">destructive — ошибка</span>
        </Demo>

        <Demo
          label="Цвет данных"
          rule="только для графиков; серьёзные дашборды берут палитру из shared/ui/chart/palette.ts"
        >
          {CHARTS.map((c) => (
            <Swatch key={c} token={c.replace('bg-', '')} className={c} />
          ))}
        </Demo>

        <Demo
          label="Цвет личности"
          rule="устойчивый цвет кружка по id — shared/lib/identity-color.ts, восемь равноправных оттенков"
        >
          {IDENTITY_COLORS.map((c) => (
            <span
              key={c}
              className={cn(
                'flex size-9 items-center justify-center rounded-full text-sm font-medium text-white',
                c,
              )}
            >
              {identityInitials('Айгерим Касымова')}
            </span>
          ))}
          <Caption>это не статус: семантики у оттенка нет, он только различает людей</Caption>
        </Demo>

        <Demo label="Брендовый градиент" rule="shared/config/brand.ts — обложки и текстовые посты">
          <div className={cn('h-16 w-48 rounded-xl', BRAND_GRADIENT)} />
          <Code>BRAND_GRADIENT</Code>
        </Demo>

        <Pitfall>
          Текст на цветной заливке — парный <Code>*-foreground</Code> или тот же токен, что и
          заливка. <Code>text-white</Code> на цветном фоне ломается в тёмной теме, где поверхность
          светлеет.
        </Pitfall>
      </Section>

      <Section
        id="type"
        title="Типографика"
        note="Один шрифт Inter Variable. Не больше трёх типографических уровней на экран: остальная иерархия — весом и цветом, а не размером."
      >
        <div className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          {TYPE_SCALE.map((t) => (
            <div
              key={t.role}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border pb-3 last:border-b-0 last:pb-0"
            >
              <span className={t.cls}>{t.role}</span>
              <span className="flex items-center gap-2">
                <Code>{t.cls}</Code>
                <Caption>{t.where}</Caption>
              </span>
            </div>
          ))}
        </div>

        <Demo label="Числа" rule="в колонках и счётчиках — tabular-nums, иначе цифры «пляшут»">
          <span className="font-mono text-sm tabular-nums">1 204 · 98 · 7</span>
          <Caption>tabular-nums</Caption>
          <span className="text-2xl font-semibold leading-none">1 204</span>
          <Caption>крупное число — пропорциональными</Caption>
        </Demo>

        <Demo label="Обрезка длинного значения" className="block">
          <div className="flex w-full max-w-sm min-w-0 items-center gap-2 rounded-lg bg-muted/50 p-2">
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate text-sm">
              Справка с места учёбы для предоставления по месту требования
            </span>
          </div>
          <Pitfall>
            <Code>truncate</Code> без <Code>min-w-0</Code> на родителе-флексе не работает: строка
            распирает контейнер вместо обрезки.
          </Pitfall>
        </Demo>
      </Section>

      <Section
        id="space"
        title="Пространство"
        note="База 4 px. Лестница 1 · 1.5 · 2 · 3 · 4 · 6. Значения 2.5 и 5 — вне шкалы, в новом коде не используются."
      >
        <div className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          {SPACING.map((s) => (
            <div key={s.cls} className="flex items-center gap-4">
              <span className="w-20 shrink-0">
                <Code>{s.cls}</Code>
              </span>
              <span className={`flex ${s.cls}`}>
                <span className="size-4 rounded bg-primary/70" />
                <span className="size-4 rounded bg-primary/70" />
                <span className="size-4 rounded bg-primary/70" />
              </span>
              <Caption>
                {s.px} — {s.role}
              </Caption>
            </div>
          ))}
        </div>
      </Section>

      <Section
        id="shape"
        title="Форма и слои"
        note="Радиусы вычисляются от одного корня --radius: 0.625rem. Внутренний элемент скругляется на ступень меньше внешнего."
      >
        <Demo label="Радиусы">
          {RADII.map((r) => (
            <div key={r.cls} className="flex w-36 flex-col gap-1.5">
              <div className={`h-12 bg-primary/15 ring-1 ring-foreground/10 ${r.cls}`} />
              <Code>{r.cls}</Code>
              <Caption>{r.role}</Caption>
            </div>
          ))}
        </Demo>

        <Demo label="Поверхности и высота" className="items-stretch">
          <div className="w-44 rounded-xl bg-muted/30 p-3 text-xs">
            <span className="font-medium">0. Фон</span>
            <p className="mt-1 text-muted-foreground">bg-muted/30</p>
          </div>
          <div className="w-44 rounded-xl border-b border-border bg-sidebar p-3 text-xs">
            <span className="font-medium">1. Навигация</span>
            <p className="mt-1 text-muted-foreground">bg-sidebar</p>
          </div>
          <div className="w-44 rounded-xl bg-card p-3 text-xs ring-1 ring-foreground/10">
            <span className="font-medium">2. Контент</span>
            <p className="mt-1 text-muted-foreground">bg-card + ring-1</p>
          </div>
          <div className="w-44 rounded-xl border border-border bg-popover p-3 text-xs shadow-lg">
            <span className="font-medium">3. Парящее</span>
            <p className="mt-1 text-muted-foreground">bg-popover + shadow-lg</p>
          </div>
          <div className="w-44 rounded-2xl bg-card p-3 text-xs ring-1 ring-foreground/10">
            <span className="font-medium">4. Модальное</span>
            <p className="mt-1 text-muted-foreground">rounded-2xl + оверлей</p>
          </div>
        </Demo>

        <Pitfall>
          Тень означает «парит над страницей» и допустима только на уровнях 3–4. Инлайн-поверхность
          отделяется кольцом <Code>ring-1 ring-foreground/10</Code>, а не подъёмом.
        </Pitfall>

        <Demo label="Шкала z-index" className="block">
          <div className="flex w-full flex-col gap-2">
            {LAYERS.map((l) => (
              <div key={l.z} className="flex items-center gap-3">
                <span className="w-24 shrink-0">
                  <Code>{l.z}</Code>
                </span>
                <Caption>{l.role}</Caption>
              </div>
            ))}
          </div>
        </Demo>
      </Section>

      <Section
        id="icons"
        title="Иконки"
        note="Единственный набор — lucide-react. Внутри Button размер иконке не задаётся: кнопка выставляет его сама."
      >
        <Demo label="Размеры">
          {ICONS.map(({ cls, Icon, role }) => (
            <div key={cls} className="flex w-32 flex-col items-start gap-1.5">
              <Icon className={cls} aria-hidden />
              <Code>{cls}</Code>
              <Caption>{role}</Caption>
            </div>
          ))}
        </Demo>

        <Demo label="Ведущая иконка строки" rule="скруглённый квадрат на подложке токена">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileText className="size-5" aria-hidden />
          </span>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning">
            <FileText className="size-5" aria-hidden />
          </span>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <FileText className="size-5" aria-hidden />
          </span>
          <Caption>size-9 в плотных списках, size-10 в обычных</Caption>
        </Demo>
      </Section>

      <Section
        id="motion"
        title="Движение"
        note="Анимация объясняет, откуда взялся элемент. Декоративное движение обязано выключаться по prefers-reduced-motion."
      >
        <Demo
          label="Длительности"
          rule="наведите курсор — квадрат меняет цвет с указанной скоростью"
        >
          {DURATIONS.map((d) => (
            <div key={d.cls} className="flex w-40 flex-col gap-1.5">
              <div
                className={`h-12 rounded-lg bg-muted transition-colors hover:bg-primary ${d.cls}`}
              />
              <Code>{d.cls}</Code>
              <Caption>{d.role}</Caption>
            </div>
          ))}
        </Demo>

        <Pitfall>
          Анимация не двигает раскладку: только <Code>transform</Code> и <Code>opacity</Code>.
          Анимация высоты в списках дёргает соседние строки.
        </Pitfall>
      </Section>
    </div>
  )
}
