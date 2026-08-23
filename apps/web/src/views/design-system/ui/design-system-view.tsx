'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'

import { SegmentedTabs } from '../../../shared/ui'
import { ComponentsSection } from './components-section'
import { FoundationsSection } from './foundations-section'
import { PatternsSection } from './patterns-section'
import { Code } from './kit'

// Живая витрина дизайн-системы (docs/DESIGN_SYSTEM.md). Инструмент разработки, не
// продуктовый экран: маршрут /_dev/design-system, за middleware, в навигацию не выведен.
// Тексты здесь намеренно не в i18n — переводить инструмент разработчика на три языка
// смысла нет, а 300 служебных ключей засорили бы словари продукта.

const NAV = [
  { id: 'principles', label: 'Принципы' },
  { id: 'color', label: 'Цвет' },
  { id: 'type', label: 'Типографика' },
  { id: 'space', label: 'Пространство' },
  { id: 'shape', label: 'Форма и слои' },
  { id: 'icons', label: 'Иконки' },
  { id: 'motion', label: 'Движение' },
  { id: 'buttons', label: 'Кнопки' },
  { id: 'badges', label: 'Бейджи' },
  { id: 'inputs', label: 'Поля' },
  { id: 'surfaces', label: 'Карточки' },
  { id: 'nav', label: 'Шапка и табы' },
  { id: 'feedback', label: 'Состояния' },
  { id: 'overlays', label: 'Оверлеи' },
  { id: 'row-card', label: 'Строка списка' },
  { id: 'states', label: 'Три состояния' },
  { id: 'form', label: 'Форма' },
  { id: 'settings', label: 'Настройки' },
  { id: 'tiles', label: 'Плитки' },
]

const PRINCIPLES = [
  {
    title: 'Телефон — основной экран',
    body: 'Студент открывает расписание стоя в коридоре. Верстка проверяется на 375 px раньше, чем на 1280.',
  },
  {
    title: 'Плотность важнее воздуха',
    body: 'Это рабочая система: списки студентов, заявок, оценок. Выигрывает вариант, где помещается больше строк.',
  },
  {
    title: 'Один способ сделать одно',
    body: 'Двух видов карточки или таба быть не может. Нет компонента — обсуждаем добавление в shared/ui, а не собираем локальный.',
  },
  {
    title: 'Цвет — семантика, а не палитра',
    body: 'bg-amber-500 в коде экрана — ошибка: есть warning. Сырьё палитры допустимо только в графиках.',
  },
  {
    title: 'Ничего не держится на одном цвете',
    body: 'Статус читают дальтоники, скриншот печатают ч/б. Статус = цвет и текст (или иконка).',
  },
  {
    title: 'Состояние экрана всегда явное',
    body: 'У каждой асинхронной области есть loading, empty и error. Пустой div на время загрузки — незакрытая задача.',
  },
]

/** Переключатель темы витрины: система, светлая, тёмная. */
function ThemeSwitch() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // До гидрации активная тема неизвестна (next-themes читает её на клиенте) —
  // рисуем нейтральную заглушку той же ширины, чтобы шапка не прыгала.
  useEffect(() => setMounted(true), [])
  if (!mounted) return <div className="h-8 w-32" aria-hidden />

  return (
    <SegmentedTabs
      aria-label="Тема"
      value={theme === 'dark' ? 'dark' : theme === 'light' ? 'light' : 'system'}
      onChange={setTheme}
      items={[
        { value: 'light', label: 'Светлая', icon: Sun },
        { value: 'dark', label: 'Тёмная', icon: Moon },
        { value: 'system', label: 'Системная' },
      ]}
    />
  )
}

export function DesignSystemView() {
  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border bg-sidebar px-4 py-3 md:px-6">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold">Дизайн-система StudentHub</h1>
          <p className="truncate text-sm text-muted-foreground">
            Живая витрина · docs/DESIGN_SYSTEM.md
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <ThemeSwitch />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[100rem] gap-8 p-4 md:p-6">
        {/* Оглавление: на узких экранах прячем — навигация по якорям там бесполезна. */}
        <nav
          aria-label="Разделы витрины"
          className="sticky top-20 hidden h-fit w-52 shrink-0 flex-col gap-0.5 xl:flex"
        >
          {NAV.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <main className="flex min-w-0 flex-1 flex-col gap-10">
          <section id="principles" className="flex scroll-mt-20 flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-bold">Принципы</h2>
              <p className="max-w-3xl text-sm text-muted-foreground">
                Шесть правил с проверяемыми следствиями. Если решение нарушает принцип — оно
                неверно, даже когда выглядит красиво. Полный текст, включая долг и план миграции, —
                в <Code>docs/DESIGN_SYSTEM.md</Code>.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {PRINCIPLES.map((p, index) => (
                <div
                  key={p.title}
                  className="flex flex-col gap-1.5 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
                >
                  <span className="text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                  <h3 className="text-base font-medium">{p.title}</h3>
                  <p className="text-sm text-muted-foreground">{p.body}</p>
                </div>
              ))}
            </div>
          </section>

          <FoundationsSection />
          <ComponentsSection />
          <PatternsSection />

          <footer className="border-t border-border pt-4 pb-10 text-xs text-muted-foreground">
            Новый компонент в <Code>shared/ui</Code> попадает в витрину той же задачей. Компонент
            без витрины считается незаконченным.
          </footer>
        </main>
      </div>
    </div>
  )
}
