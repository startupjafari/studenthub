'use client'

import { useEffect, useRef, useState } from 'react'
import type { Dictionary } from '../content'
import { Reveal, Section, SectionHeading } from './primitives'
import { Scene } from './scenes'

/** Сколько держится момент, пока день идёт сам. */
const AUTOPLAY_MS = 5500

/**
 * Сюжет «Один день студента» — пять моментов на шкале времени.
 *
 * День идёт сам, пока секция в кадре: момент сменяется каждые 5,5 секунды. Наведение или
 * фокус ставят его на паузу — человек читает, и уводить содержимое из-под курсора нельзя.
 * Клик по метке выбирает момент вручную и останавливает автопоказ насовсем: дальше он
 * ведёт сам.
 *
 * Раскладка компактная, без липкого экрана: сюжет должен читаться одним взглядом —
 * шкала, момент и телефон рядом, а не разнесённые на высоту экрана.
 */
export function Day({ dict }: { dict: Dictionary }) {
  const t = dict.day
  const total = t.frames.length

  const [activeIndex, setActiveIndex] = useState(0)
  const [inView, setInView] = useState(false)
  const [paused, setPaused] = useState(false)
  const [manual, setManual] = useState(false)

  const sectionRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Автопоказ идёт, только пока секция на экране: иначе день промотается целиком, пока
  // человек читает другую часть страницы, и к моменту прихода сюда всё уже кончилось.
  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry?.isIntersecting ?? false),
      { threshold: 0.35 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!inView || paused || manual) return
    const id = setInterval(() => setActiveIndex((i) => (i + 1) % total), AUTOPLAY_MS)
    return () => clearInterval(id)
  }, [inView, paused, manual, total])

  /** Ручной выбор момента. После него автопоказ не возвращается. */
  function select(index: number) {
    setManual(true)
    setActiveIndex(index)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const last = total - 1
    let next: number | null = null
    if (e.key === 'ArrowRight') next = activeIndex === last ? 0 : activeIndex + 1
    if (e.key === 'ArrowLeft') next = activeIndex === 0 ? last : activeIndex - 1
    if (e.key === 'Home') next = 0
    if (e.key === 'End') next = last
    if (next === null) return
    e.preventDefault()
    select(next)
    tabRefs.current[next]?.focus()
  }

  const active = t.frames[activeIndex] ?? t.frames[0]
  if (!active) return null

  /*
    Геометрия шкалы: метки стоят в сетке равных колонок, поэтому центр каждой — на
    (i + 0.5) / N ширины. Линия идёт от центра первой метки до центра последней, а не от
    края до края: при `justify-between` её концы торчали из-под крайних точек.
  */
  const half = 100 / total / 2
  const trackWidth = 100 - 2 * half
  const filled = total > 1 ? (activeIndex / (total - 1)) * trackWidth : 0

  return (
    <Section id="product" className="bg-muted/40">
      <SectionHeading title={t.title} subtitle={t.subtitle} />

      <Reveal>
        <div
          ref={sectionRef}
          // Пауза на наведении и на фокусе внутри блока: и мышь, и клавиатура означают,
          // что человек сейчас читает именно здесь.
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={() => setPaused(false)}
          className="flex flex-col gap-[clamp(1.75rem,3vw,2.75rem)]"
        >
          {/*
            Шкала времени. На узком экране прокручивается вбок, потому что пять меток с
            подписями в строку не помещаются никогда: `min-w` держит шаг колонки, а
            горизонтальная прокрутка страницы при этом не появляется — едет сам ряд.
          */}
          <div className="sh-fade-x -mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:overflow-visible sm:px-0 sm:[mask-image:none]">
            {/* 26rem — пять колонок по ~83 px: столько нужно, чтобы «Уведомление» и
                «Аудитория» не переносились. На 320 px ряд прокручивается вбок, и
                затухание у края показывает, что моменты продолжаются. */}
            <div className="relative min-w-[26rem] sm:min-w-0">
              <div
                className="absolute top-[0.4375rem] h-px bg-border"
                style={{ left: `${half}%`, width: `${trackWidth}%` }}
                aria-hidden
              />
              {/* Заполненная часть доезжает до активной метки — по ней видно, сколько
                  дня уже прошло. */}
              <div
                className="absolute top-[0.4375rem] h-px bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
                style={{ left: `${half}%`, width: `${filled}%` }}
                aria-hidden
              />

              <div
                role="tablist"
                aria-label={t.timelineLabel}
                onKeyDown={handleKeyDown}
                className="relative grid"
                style={{ gridTemplateColumns: `repeat(${total}, 1fr)` }}
              >
                {t.frames.map((frame, index) => {
                  const selected = index === activeIndex
                  const passed = index < activeIndex
                  return (
                    <button
                      key={frame.time}
                      ref={(el) => {
                        tabRefs.current[index] = el
                      }}
                      type="button"
                      role="tab"
                      id={`day-tab-${index}`}
                      aria-selected={selected}
                      aria-controls="day-panel"
                      tabIndex={selected ? 0 : -1}
                      onClick={() => select(index)}
                      className="group flex flex-col items-center gap-2 rounded-lg px-1 py-1 outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
                    >
                      <span
                        className={[
                          'relative grid size-3.5 place-items-center rounded-full border-2 bg-background transition-colors',
                          selected
                            ? 'border-primary'
                            : passed
                              ? 'border-primary/50'
                              : 'border-border group-hover:border-ring',
                        ].join(' ')}
                      >
                        {/* Пульс у активной точки: она и есть «сейчас» в этом дне. */}
                        {selected && (
                          <span className="sh-ping absolute inset-0 rounded-full bg-primary" />
                        )}
                        <span
                          className={[
                            'size-1.5 rounded-full transition-colors',
                            selected
                              ? 'bg-primary'
                              : passed
                                ? 'bg-primary/50'
                                : 'bg-transparent group-hover:bg-ring/40',
                          ].join(' ')}
                        />
                      </span>

                      <span
                        className={[
                          'text-xs font-semibold tabular-nums transition-colors',
                          selected ? 'text-primary' : 'text-foreground/70',
                        ].join(' ')}
                      >
                        {frame.time}
                      </span>
                      {/* Слово под меткой: одни цифры не говорят, что в этот момент
                          происходит. */}
                      <span
                        className={[
                          'text-[0.6875rem] leading-none whitespace-nowrap transition-colors',
                          selected ? 'text-foreground' : 'text-muted-foreground',
                        ].join(' ')}
                      >
                        {frame.label}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Кадр */}
          <div
            id="day-panel"
            role="tabpanel"
            aria-labelledby={`day-tab-${activeIndex}`}
            className="grid items-center gap-[clamp(2rem,4vw,3.5rem)] lg:grid-cols-[1fr_auto]"
          >
            {/* Вертикальная линия слева связывает кадр с активной точкой шкалы: без неё
                текст и шкала читаются как два независимых блока. */}
            <div
              key={activeIndex}
              className="sh-scene-in flex flex-col gap-3 border-l-2 border-primary/40 pl-5"
            >
              <span className="text-sm font-semibold text-primary tabular-nums">{active.time}</span>
              <h3 className="text-[clamp(1.25rem,2.2vw,1.75rem)] leading-tight font-semibold">
                {active.title}
              </h3>
              <p className="max-w-xl leading-relaxed text-foreground/70">{active.text}</p>
            </div>

            {/* Свечение за телефоном: без него аппарат висит на плоском фоне, как
                вырезанный. Радиальный градиент даёт ему подложку, не добавляя рамки.

                Без `blur`: размытие крупного слоя — самый дорогой эффект на странице, а
                градиент и так мягкий по построению. На слабом устройстве это разница
                между ровными 60 кадрами и провалами при прокрутке. */}
            <div className="relative flex min-w-0 justify-center">
              <span
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-1/2 size-[26rem] max-w-[120%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--primary)_18%,transparent)_0%,transparent_70%)]"
              />
              <Scene key={active.scene} scene={active.scene} dict={dict} time={active.time} />
            </div>
          </div>
        </div>
      </Reveal>
    </Section>
  )
}
