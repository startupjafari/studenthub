'use client'

import { useEffect, useRef, useState } from 'react'
import type { Dictionary } from '../content'
import {
  AnimatePresence,
  motion,
  SPRING,
  SWAP,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
} from './motion'
import { Container, SectionHeading } from './primitives'
import { Scene } from './scenes'

/** Сколько держится момент, пока день идёт сам (только там, где им не управляет прокрутка). */
const AUTOPLAY_MS = 5500

/**
 * Сюжет «Один день студента» — пять моментов на шкале времени.
 *
 * Момент выбирает прокрутка, а не нажатие: секция закрепляется на экране, и пока человек
 * листает, день идёт вперёд сам. Так сюжет читается в том же движении, которым читают всю
 * страницу, — отдельного действия от человека не требуется.
 *
 * Но только на широком экране. На телефоне заголовок, текст и аппарат в один экран не
 * помещаются никогда, а закреплённая секция с обрезанным содержимым — худший из вариантов:
 * там остаётся компактная раскладка с автопоказом и выбором по метке.
 *
 * Нажатие работает в обоих режимах. В режиме прокрутки метка не переключает кадр напрямую,
 * а прокручивает страницу к нужному участку: иначе состояние разъехалось бы с положением
 * страницы и следующее же движение колеса вернуло бы кадр обратно.
 */
export function Day({ dict }: { dict: Dictionary }) {
  const t = dict.day
  const total = t.frames.length

  const [activeIndex, setActiveIndex] = useState(0)
  const [scrollDriven, setScrollDriven] = useState(false)
  const [inView, setInView] = useState(false)
  const [paused, setPaused] = useState(false)
  const [manual, setManual] = useState(false)

  const calm = useReducedMotion()
  const trackRef = useRef<HTMLElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Режим решает ширина, а не устройство: дело в том, помещается ли кадр в экран целиком.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const apply = () => setScrollDriven(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  /*
    Прогресс закреплённого участка: 0 — секция только встала на экран, 1 — уходит.
    Дорожка делится на равные полосы по числу моментов, поэтому каждый держится одинаково.
  */
  const { scrollYProgress } = useScroll({
    target: trackRef,
    offset: ['start start', 'end end'],
  })

  useMotionValueEvent(scrollYProgress, 'change', (progress) => {
    if (!scrollDriven) return
    const next = Math.min(total - 1, Math.max(0, Math.floor(progress * total)))
    setActiveIndex((prev) => (prev === next ? prev : next))
  })

  // Автопоказ идёт, только пока секция на экране, и только там, где кадром не управляет
  // прокрутка: иначе таймер и колесо спорили бы за один и тот же индекс.
  useEffect(() => {
    const el = stageRef.current
    if (!el || scrollDriven) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry?.isIntersecting ?? false),
      { threshold: 0.35 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [scrollDriven])

  useEffect(() => {
    if (scrollDriven || !inView || paused || manual) return
    const id = setInterval(() => setActiveIndex((i) => (i + 1) % total), AUTOPLAY_MS)
    return () => clearInterval(id)
  }, [scrollDriven, inView, paused, manual, total])

  /** Выбор момента меткой. В режиме прокрутки ведёт страницу, а не переставляет состояние. */
  function select(index: number) {
    const track = trackRef.current
    if (scrollDriven && track) {
      const start = window.scrollY + track.getBoundingClientRect().top
      const distance = track.offsetHeight - window.innerHeight
      // Середина полосы, а не её начало: у края округление вернуло бы соседний кадр.
      const progress = (index + 0.5) / total
      window.scrollTo({
        top: start + distance * progress,
        behavior: calm ? 'auto' : 'smooth',
      })
      return
    }
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
    Геометрия шкалы. Метки стоят в равных колонках и прижаты к левому краю своей колонки,
    поэтому первая совпадает с левым краем заголовка секции, а шаг между ними одинаковый.
    Раньше содержимое колонок центрировалось: шаг был ровный, но вся шкала оказывалась
    вдвинутой внутрь на половину колонки и не сходилась ни с чем на странице.

    Линия идёт от центра первой точки до центра последней: 0.4375rem — половина точки
    (size-3.5), а ширина — все колонки, кроме последней.
  */
  const trackWidth = 100 - 100 / total
  const filled = total > 1 ? (activeIndex / (total - 1)) * trackWidth : 0

  return (
    <section id="product" ref={trackRef} className="relative scroll-mt-24 lg:h-[340vh]">
      <div
        ref={stageRef}
        // Пауза на наведении и на фокусе: и мышь, и клавиатура означают, что человек
        // сейчас читает именно здесь. В режиме прокрутки автопоказа нет, и пауза не нужна.
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
        className="py-[clamp(5rem,9vw,9rem)] lg:sticky lg:top-0 lg:flex lg:min-h-dvh lg:flex-col lg:justify-center lg:py-10"
      >
        {/*
          На широком экране — две колонки, а не стопка. В закреплённом кадре высота
          обязана быть `max(текст, аппарат)`, а не их суммой: стопкой сцена выходила на
          1071 px против 900 px экрана, и телефон обрезался нижней кромкой.
        */}
        <Container className="flex flex-col gap-10 lg:grid lg:grid-cols-[minmax(0,1fr)_16.5rem] lg:grid-rows-[auto_auto_1fr] lg:items-start lg:gap-x-[clamp(2rem,4vw,4rem)]">
          <div className="lg:col-span-2">
            <SectionHeading title={t.title} subtitle={t.subtitle} />
          </div>

          {/*
            Шкала времени. На узком экране прокручивается вбок, потому что пять меток с
            подписями в строку не помещаются никогда: `min-w` держит шаг колонки, а
            горизонтальная прокрутка страницы при этом не появляется — едет сам ряд.
          */}
          <div className="sh-fade-x sh-fade-x--sm-only -mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:overflow-visible sm:px-0 lg:col-start-1 lg:row-start-2 [&::-webkit-scrollbar]:hidden">
            <div className="relative min-w-[26rem] sm:min-w-0">
              <div
                className="absolute top-[0.4375rem] left-[0.4375rem] h-px bg-hairline"
                style={{ width: `${trackWidth}%` }}
                aria-hidden
              />
              {/* Заполненная часть доезжает до активной метки — по ней видно, сколько
                  дня уже прошло. */}
              <div
                className="absolute top-[0.4375rem] left-[0.4375rem] h-px bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
                style={{ width: `${filled}%` }}
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
                      className="group flex min-h-11 flex-col items-start gap-2 rounded-xl pr-3 pb-2 text-left outline-none focus-visible:ring-4 focus-visible:ring-ring/25"
                    >
                      <span
                        className={[
                          'relative grid size-3.5 place-items-center rounded-full border-2 bg-background transition-colors',
                          selected
                            ? 'border-primary'
                            : passed
                              ? 'border-primary/50'
                              : 'border-hairline group-hover:border-primary/50',
                        ].join(' ')}
                      >
                        {/* Пульс у активной точки: она и есть «сейчас» в этом дне. */}
                        {selected && (
                          <span className="sh-ping absolute inset-0 rounded-full bg-primary" />
                        )}
                        {/*
                          Кольцо с общим layoutId: при смене момента Framer Motion считает
                          его тем же элементом и физически переносит между метками. Так
                          видно, что выбор переехал, а не мигнул в другом месте.
                        */}
                        {selected && !calm && (
                          <motion.span
                            layoutId="day-dot-ring"
                            transition={SPRING}
                            aria-hidden
                            className="absolute -inset-1.5 rounded-full border border-primary/45"
                          />
                        )}
                        <span
                          className={[
                            'size-1.5 rounded-full transition-colors',
                            selected
                              ? 'bg-primary'
                              : passed
                                ? 'bg-primary/50'
                                : 'bg-transparent group-hover:bg-primary/40',
                          ].join(' ')}
                        />
                      </span>

                      <span
                        className={[
                          'font-mono text-xs font-semibold tabular-nums transition-colors',
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
            className="lg:col-start-1 lg:row-start-3"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activeIndex}
                initial={calm ? false : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={calm ? undefined : { opacity: 0, y: -12 }}
                transition={SWAP}
                className="flex flex-col gap-4 border-l border-primary/40 pl-6"
              >
                <span className="font-mono text-sm font-medium text-primary tabular-nums">
                  {active.time}
                </span>
                <h3 className="font-display text-[clamp(1.35rem,2.4vw,1.9rem)] leading-tight font-semibold tracking-[-0.02em]">
                  {active.title}
                </h3>
                <p className="max-w-[52ch] leading-relaxed text-muted-foreground">{active.text}</p>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Аппарат вне панели кадра: это иллюстрация, и в сетке он занимает вторую
              колонку целиком — обе строки, от шкалы до текста. */}
          <div className="lg:col-start-2 lg:row-span-2 lg:row-start-2 lg:self-center">
            {/* Свечение за телефоном: без него аппарат висит на плоском фоне, как
                вырезанный. Радиальный градиент даёт ему подложку, не добавляя рамки.

                Без `blur`: размытие крупного слоя — самый дорогой эффект на странице, а
                градиент и так мягкий по построению. На слабом устройстве это разница
                между ровными 60 кадрами и провалами при прокрутке. */}
            <div className="relative flex min-w-0 justify-center">
              <span
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-1/2 size-[26rem] max-w-full -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--primary)_18%,transparent)_0%,transparent_70%)]"
              />
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={active.scene}
                  className="w-full"
                  initial={calm ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={calm ? undefined : { opacity: 0, y: -10 }}
                  transition={SWAP}
                >
                  <Scene scene={active.scene} dict={dict} time={active.time} />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </Container>
      </div>
    </section>
  )
}
