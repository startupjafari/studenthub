'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useTranslations } from 'next-intl'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  MoreVertical,
  RotateCcw,
  Save,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  downloadKeyOf,
  useBackClose,
  useBodyScrollLock,
  useFileDownload,
  useMediaGestures,
} from '../lib'
import type { MediaSource } from '../api/media'
import { ProgressRing } from './progress-ring'
import { cn } from '../lib/utils'
import { MOTION } from '../lib/motion'
import { prefersReducedMotion } from '../lib/spring'
import { srcSetOf, pickSource } from '../lib/media-source'
import { VideoPlayer } from './video-player'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu'
import { flyFromOrigin, flyToOrigin, mediaRatio } from './media-viewer-motion'

export interface MediaViewerItem {
  mime: string
  name?: string | null
}

/** Варианты текущего элемента из медиа-системы: заглушка, srcset, постер и HLS. */
export interface MediaViewerMedia {
  placeholder?: string | null
  width?: number | null
  height?: number | null
  sources?: readonly MediaSource[]
  poster?: readonly MediaSource[]
  hls?: string | null
}

/**
 * Действие над текущим элементом. На ПК — иконкой в шапке, на телефоне — пунктом меню «⋮»:
 * восемь иконок в ряд на 375 px не помещаются (так же разведено в Telegram).
 */
export interface MediaViewerAction {
  key: string
  label: string
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  onSelect: () => void
  tone?: 'danger'
  /** Закрыть просмотрщик после действия (перейти к сообщению, удалить) — с полётом назад. */
  closes?: boolean
}

/** Окно, в которое новое открытие ещё успевает «вырасти» из миниатюры. Дальше — без полёта. */
const FLY_IN_WINDOW_MS = 120
/** Насколько быстрее фона гаснут панели при смахивании: им незачем висеть над пустотой. */
const CHROME_FADE = 4
const BACKDROP_FADE = 1.6

// Единый полноэкранный просмотрщик фото/видео в раскладке Telegram: шапка с автором и
// действиями, медиа по центру, подпись снизу, ◀▶ по краям. Закрытие по фону/Esc/крестику и
// смахиванием вверх или вниз.
// Слой — Radix Dialog: просмотрщик открывают и из модалок (заявки, документы), и только как
// вложенный слой Radix он получает свой Esc (закрывается он, а не модалка под ним), свой
// фокус-трап (кнопки достижимы Tab'ом, а не заперты ловушкой модалки) и role="dialog".
// Жесты (shared/lib/use-media-gestures): щипок, колесо и двойной тап/клик приближают снимок,
// увеличенный возится пальцем, свайп поперёк листает, вдоль — закрывает. Видео играет наш
// VideoPlayer, а не системный плеер телефона; зум ему выключен — касания нужны контролам.
// Открытие вырастает из миниатюры, закрытие садится обратно (media-viewer-motion), если
// вызывающий подсказал, где она (`getOrigin`).
// Универсальный: URL текущего элемента резолвит вызывающий (src), слоты topLeft/caption и
// список действий позволяют доклеить контекст — используется и в чате, и в профиле.
export function MediaViewer({
  items,
  index,
  src,
  media,
  onIndexChange,
  onClose,
  topLeft,
  caption,
  menu,
  downloadUrl,
  downloadName,
  downloadKey,
  getOrigin,
  onContextMenuCapture,
  itemKey,
}: {
  items: MediaViewerItem[]
  index: number
  /** Готовый URL текущего элемента; undefined — показываем спиннер (ленивая загрузка). */
  src?: string
  /**
   * Варианты текущего элемента. Заглушка (LQIP) показывается сразу — даже пока едет `src`;
   * снимок выбирается из копий по размеру экрана, видео играет через HLS. Нет — как раньше.
   */
  media?: MediaViewerMedia | null
  onIndexChange: (i: number) => void
  onClose: () => void
  /**
   * Левая часть шапки: кто прислал и когда. Функцией — если блок сам закрывает просмотрщик
   * (перейти к сообщению): получает закрытие с полётом назад. Нет — там счётчик «N из M».
   */
  topLeft?: ReactNode | ((close: () => void) => ReactNode)
  caption?: ReactNode
  /** Действия над текущим элементом (переслать, удалить…), см. `MediaViewerAction`. */
  menu?: MediaViewerAction[]
  downloadUrl?: string
  downloadName?: string | null
  /**
   * Ключ скачивания (shared/lib/file-download): у вложения чата — `file:<id>`, тот же, что у
   * строки файла в переписке, чтобы начатое там было видно здесь. Нет — путь объекта.
   */
  downloadKey?: string
  /**
   * Миниатюра элемента в ленте: из неё снимок вырастает при открытии и в неё же садится при
   * закрытии. Нет или она не в окне — просмотрщик просто проявляется и тает.
   */
  getOrigin?: (index: number) => HTMLElement | null
  onContextMenuCapture?: (e: React.MouseEvent) => void
  /**
   * Ключ текущего элемента, если список растёт с начала (лента всех медиа чата подгружает
   * более старые слева): индекс того же кадра сдвигается, и сброс поворота и зума по индексу
   * сбросил бы их посреди просмотра. Нет — сброс по индексу, как раньше.
   */
  itemKey?: string
}) {
  const t = useTranslations('Common')
  // Второй аргумент — запрет выделения на всей странице: оверлей перетаскивают,
  // и без него браузер выделяет текст, лежащий ПОД ним (см. хук).
  useBodyScrollLock(true, true)
  const [rotation, setRotation] = useState(0)
  // Масштаб «вписать повёрнутое»: поворот не меняет место, которое элемент занимает в
  // раскладке, поэтому у горизонтального снимка, повёрнутого на 90°, габарит становится
  // выше области просмотра и края уезжают под `overflow-hidden`. Считаем, во сколько раз
  // ужать, чтобы повёрнутый прямоугольник влез целиком.
  const [fit, setFit] = useState(1)
  const [closing, setClosing] = useState(false)
  // Callback-ref, а не объектный: один ref на <img> и <video> объектным пришлось бы
  // типизировать пересечением их интерфейсов — ложью, которую TS пропускает по случайности.
  const mediaRef = useRef<HTMLElement | null>(null)
  // Узел ещё и в состоянии: окно рисуется в портале Radix, который появляется только со
  // второго прохода рендера. Полёт из миниатюры ждёт именно появления узла — по одному ref
  // его эффект отрабатывал раньше портала, не находил снимок и больше не запускался.
  const [mediaEl, setMediaEl] = useState<HTMLElement | null>(null)
  const setMedia = useCallback((el: HTMLImageElement | HTMLVideoElement | null): void => {
    mediaRef.current = el
    setMediaEl(el)
  }, [])
  const contentRef = useRef<HTMLDivElement | null>(null)
  const backdropRef = useRef<HTMLDivElement | null>(null)
  const headRef = useRef<HTMLDivElement | null>(null)
  const footRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const cur = items[index]
  const isVideo = !!cur?.mime.startsWith('video/')

  // Колбэки и данные, нужные закрытию, — через ref: закрытие стартует из обработчиков
  // жестов, Esc и истории, и замыкание с прошлого рендера закрыло бы не тот кадр.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const getOriginRef = useRef(getOrigin)
  getOriginRef.current = getOrigin
  const latest = useRef({ index, rotation, media })
  latest.current = { index, rotation, media }
  const closingRef = useRef(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Слой жестов: зум снимка, листание и смахивание. Объявлен до закрытия — тому нужен stop().
  const gesturesRef = useRef<{
    stop: () => void
    layerRef: React.RefObject<HTMLDivElement | null>
  } | null>(null)
  // Меню «⋮» только что закрыли касанием мимо него — это касание не должно закрыть ещё и
  // просмотрщик (слой просмотрщика ловит нажатия и под модальным меню).
  const menuClosedAt = useRef(0)
  const menuJustClosed = (): boolean => performance.now() - menuClosedAt.current < 400

  /**
   * Закрыть с полётом: снимок садится в миниатюру (или уходит за край по направлению
   * смахивания), фон и панели тают. Логика не ждёт анимацию (§7): размонтирует родитель,
   * а таймер — подстраховка, если `finish` не придёт (элемент сняли посреди полёта).
   */
  const requestClose = useCallback((direction?: 1 | -1): void => {
    if (closingRef.current) return
    closingRef.current = true
    const done = (): void => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
      closeTimer.current = null
      onCloseRef.current()
    }
    if (prefersReducedMotion()) {
      done()
      return
    }
    setClosing(true)
    gesturesRef.current?.stop()
    const fade = (el: HTMLElement | null): void => {
      if (!el) return
      el.style.transition = `opacity ${MOTION.exit}ms ${MOTION.ease}`
      el.style.opacity = '0'
    }
    fade(backdropRef.current)
    fade(headRef.current)
    fade(footRef.current)

    const { index: i, rotation: rot, media: dims } = latest.current
    const el = mediaRef.current
    // Повёрнутый кадр не садится в неповёрнутую миниатюру — он просто тает.
    const flight =
      el && rot % 360 === 0
        ? flyToOrigin({
            media: el,
            layer: gesturesRef.current?.layerRef.current ?? null,
            origin: getOriginRef.current?.(i) ?? null,
            ratio: mediaRatio(el, dims),
            direction,
          })
        : null
    if (flight) {
      flight.onfinish = done
      if (stageRef.current) stageRef.current.style.overflow = 'visible'
    } else fade(stageRef.current)
    closeTimer.current = setTimeout(done, MOTION.exit + 80)
  }, [])

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
    },
    [],
  )

  useBackClose(requestClose)

  // Смахивание гасит фон и панели по мере того, как кадр утаскивают, — прямо в DOM, без
  // ререндера на каждый кадр жеста.
  const onDismissProgress = useCallback((p: number): void => {
    if (closingRef.current) return
    const set = (el: HTMLElement | null, value: number): void => {
      if (!el) return
      el.style.transition = ''
      el.style.opacity = p > 0 ? String(Math.max(0, value)) : ''
    }
    set(backdropRef.current, 1 - p * BACKDROP_FADE)
    set(headRef.current, 1 - p * CHROME_FADE)
    set(footRef.current, 1 - p * CHROME_FADE)
  }, [])

  // Слой зума живёт над медиа, поэтому поворот и вписывание снимка остаются его
  // собственной трансформацией и с жестом не конфликтуют.
  // Где масштаб относительно краёв: кнопка «отдалить» гаснет на 1:1, «приблизить» — на
  // пределе, чтобы было видно, куда ещё можно. Состояние меняется только на краях, поэтому
  // кадры пружины ререндера не вызывают (одинаковое значение React отбрасывает).
  const [zoomEdge, setZoomEdge] = useState<'min' | 'mid' | 'max'>('min')
  const onScaleChange = useCallback((s: number): void => {
    setZoomEdge(s <= 1.01 ? 'min' : s >= VIEWER_MAX_SCALE - 0.01 ? 'max' : 'mid')
  }, [])
  const gestures = useMediaGestures({
    content: mediaRef,
    zoomDisabled: isVideo,
    maxScale: VIEWER_MAX_SCALE,
    onScaleChange,
    canPage: (direction) => (direction === 1 ? index < items.length - 1 : index > 0),
    onPage: (direction) => onIndexChange(index + direction),
    onDismiss: (direction) => requestClose(direction),
    onDismissProgress,
  })
  gesturesRef.current = { stop: gestures.stop, layerRef: gestures.layerRef }
  const boxRef = gestures.surfaceRef
  const resetGestures = gestures.reset

  const current = itemKey ?? index
  useEffect(() => setRotation(0), [current])

  // Новый кадр и поворот показываем в исходном масштабе: границы хода у них свои. `src` в
  // зависимостях не нужен — от подгрузки URL масштаб не меняется, а сброс посреди въезда
  // нового кадра оборвал бы его.
  useEffect(() => resetGestures(), [resetGestures, current, rotation])

  // Полёт из миниатюры — один раз, в первый кадр, когда медиа уже в разметке. Ссылка могла
  // ещё ехать: тогда к её приезду фон давно проявился, и вырастать поверх него было бы
  // поздно — кадр просто появляется.
  const [openedAt] = useState(() => (typeof performance === 'undefined' ? 0 : performance.now()))
  const flewRef = useRef(false)
  useLayoutEffect(() => {
    if (flewRef.current) return
    const el = mediaRef.current
    if (!el) return
    flewRef.current = true
    if (performance.now() - openedAt > FLY_IN_WINDOW_MS || prefersReducedMotion()) return
    const flight = flyFromOrigin(el, getOriginRef.current?.(index) ?? null, mediaRatio(el, media))
    // Миниатюра бывает и над областью медиа (под шапкой): на время полёта рамка области
    // снимок не обрезает.
    const stage = stageRef.current
    if (flight && stage) {
      stage.style.overflow = 'visible'
      const restore = (): void => {
        stage.style.overflow = ''
      }
      flight.onfinish = restore
      flight.oncancel = restore
    }
    // По приезду ссылки или появлению снимка в портале; повторно не летит (флаг выше).
  }, [src, mediaEl])

  const measureFit = useCallback((): void => {
    const box = boxRef.current
    const el = mediaRef.current
    if (!box || !el) return
    const quarter = ((rotation % 360) + 360) % 360
    if (quarter !== 90 && quarter !== 270) {
      setFit(1)
      return
    }
    // offsetWidth/Height — размер ДО трансформации (getBoundingClientRect вернул бы уже
    // повёрнутый габарит, и масштаб пересчитывался бы сам от себя).
    const w = el.offsetWidth
    const h = el.offsetHeight
    if (!w || !h) return
    // Повёрнутый прямоугольник меняет стороны местами: ширина меряется высотой.
    // Больше единицы не увеличиваем — растянутый снимок хуже вписанного.
    setFit(Math.min(1, box.clientWidth / h, box.clientHeight / w))
  }, [boxRef, rotation])

  // Пересчёт при повороте, смене элемента и изменении окна. `src` в зависимостях не
  // случайно: пока картинка не загрузилась, мерить нечего — есть ещё onLoad ниже.
  useEffect(() => {
    measureFit()
    window.addEventListener('resize', measureFit)
    return () => window.removeEventListener('resize', measureFit)
  }, [measureFit, src, index])

  const getScale = gestures.getScale
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Esc обрабатывает сам Radix Dialog (onOpenChange): так закрывается только верхний слой.
      // Стрелки в поле ввода окна поверх (пересылка: поиск, подпись) двигают курсор, а не
      // листают снимки под окном.
      const el = e.target as HTMLElement | null
      if (el?.closest('input, textarea, [contenteditable="true"], [role="slider"]')) return
      // Увеличенный снимок стрелками не листается (как в Telegram): человек его разглядывает.
      // Видео во весь экран — тоже: там стрелки перематывают (VideoPlayer).
      if (getScale() > 1 || document.fullscreenElement) return
      if (e.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1)
      else if (e.key === 'ArrowRight' && index < items.length - 1) onIndexChange(index + 1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [index, items.length, onIndexChange, getScale])

  if (!cur) return null
  const transform = { transform: `rotate(${rotation}deg) scale(${fit})` }
  const dl = downloadUrl ?? src
  const actions = menu ?? []
  const runAction = (a: MediaViewerAction): void => {
    a.onSelect()
    if (a.closes) requestClose()
  }
  const counter =
    items.length > 1 ? t('tgMedia.counter', { current: index + 1, total: items.length }) : null

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(next) => {
        if (!next) requestClose()
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          ref={contentRef}
          aria-describedby={undefined}
          // Фокус — на сам слой, а не на первую кнопку шапки: иначе пробел, которым ставят
          // видео на паузу, нажимал бы «перейти к сообщению». Tab дальше идёт по кнопкам.
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            contentRef.current?.focus({ preventScroll: true })
          }}
          // `pointer-events-auto` обязателен: Radix Dialog модалки под просмотрщиком ставит
          // body `pointer-events: none`, и без него поворот, скачивание и крестик не
          // нажимались бы. Пока слой улетает, он уже ничего не ловит.
          // Маркер для глобального Esc (shared/lib/use-escape-back): пока слой открыт,
          // Esc закрывает его, а не уводит на предыдущую страницу.
          data-overlay
          className={cn(
            'fixed inset-0 z-[100] flex select-none flex-col outline-none',
            closing ? 'pointer-events-none' : 'pointer-events-auto',
          )}
          onClick={(e) => {
            e.stopPropagation()
            if (!menuJustClosed()) requestClose()
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onContextMenuCapture?.(e)
          }}
        >
          {/* Фон отдельным слоем: он проявляется и гаснет сам по себе (смахивание, полёт), а
              снимок поверх остаётся непрозрачным. */}
          <div
            ref={backdropRef}
            aria-hidden
            className="absolute inset-0 bg-black/90 duration-(--motion-modal) animate-in fade-in-0"
          />
          {/* Имя слоя для скринридера: Radix Dialog без заголовка не объявляет, что открылось. */}
          <DialogPrimitive.Title className="sr-only">
            {cur.name || t('mediaViewer')}
          </DialogPrimitive.Title>

          {/* Шапка как в Telegram: слева — кто прислал и когда, справа — действия. На
              телефоне крестик слева, а действия уходят в «⋮». */}
          <div
            ref={headRef}
            className="relative z-10 flex min-h-14 items-center gap-1 px-2 py-2 text-white duration-(--motion-modal) animate-in fade-in-0 sm:px-4"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label={t('close')}
              title={t('close')}
              onClick={() => requestClose()}
              className={cn(VIEWER_ICON_BUTTON, 'sm:hidden')}
            >
              <X className="size-5" aria-hidden />
            </button>
            <div className="min-w-0 flex-1">
              {(typeof topLeft === 'function' ? topLeft(() => requestClose()) : topLeft) ??
                (counter && (
                  <span className="px-1 text-sm text-white/70 tabular-nums">{counter}</span>
                ))}
            </div>

            <div className="hidden items-center gap-1 sm:flex">
              {actions.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  aria-label={a.label}
                  title={a.label}
                  onClick={() => runAction(a)}
                  className={cn(
                    VIEWER_ICON_BUTTON,
                    a.tone === 'danger' && 'text-red-400 hover:text-red-300',
                  )}
                >
                  <a.icon className="size-5" aria-hidden />
                </button>
              ))}
              {/* Отбивка между действиями над сообщением и управлением просмотром. */}
              {actions.length > 0 && <span className="mx-1 h-5 w-px bg-white/15" aria-hidden />}
              {!isVideo && (
                <>
                  <button
                    type="button"
                    aria-label={t('tgMedia.zoomOut')}
                    title={t('tgMedia.zoomOut')}
                    onClick={() => gestures.zoomStep(-1)}
                    disabled={zoomEdge === 'min'}
                    className={VIEWER_ICON_BUTTON}
                  >
                    <ZoomOut className="size-5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={t('tgMedia.zoomIn')}
                    title={t('tgMedia.zoomIn')}
                    onClick={() => gestures.zoomStep(1)}
                    disabled={zoomEdge === 'max'}
                    className={VIEWER_ICON_BUTTON}
                  >
                    <ZoomIn className="size-5" aria-hidden />
                  </button>
                </>
              )}
              <button
                type="button"
                aria-label={t('rotate')}
                title={t('rotate')}
                // Против часовой — как кнопка в Telegram и как rotate90 в кадрировании
                // (image-crop-modal). Здесь крутило в обратную сторону: два одинаковых с
                // виду поворота в одном продукте вели себя по-разному.
                onClick={() => setRotation((r) => r - 90)}
                className={VIEWER_ICON_BUTTON}
              >
                <RotateCcw className="size-5" aria-hidden />
              </button>
            </div>
            {dl && (
              <ViewerDownload
                key={downloadKey ?? downloadKeyOf(dl)}
                downloadKey={downloadKey ?? downloadKeyOf(dl)}
                url={dl}
                name={downloadName ?? cur.name ?? t('download')}
                mime={cur.mime}
              />
            )}
            <div className="sm:hidden">
              <DropdownMenu
                onOpenChange={(open) => {
                  if (!open) menuClosedAt.current = performance.now()
                }}
              >
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={t('tgMedia.more')}
                    title={t('tgMedia.more')}
                    className={VIEWER_ICON_BUTTON}
                  >
                    <MoreVertical className="size-5" aria-hidden />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  {actions
                    .filter((a) => a.tone !== 'danger')
                    .map((a) => (
                      <DropdownMenuItem key={a.key} onSelect={() => runAction(a)}>
                        <a.icon aria-hidden />
                        {a.label}
                      </DropdownMenuItem>
                    ))}
                  <DropdownMenuItem onSelect={() => setRotation((r) => r - 90)}>
                    <RotateCcw aria-hidden />
                    {t('rotate')}
                  </DropdownMenuItem>
                  {/* Опасное — в самом конце, за линией (как в меню сообщения). */}
                  {actions.some((a) => a.tone === 'danger') && <DropdownMenuSeparator />}
                  {actions
                    .filter((a) => a.tone === 'danger')
                    .map((a) => (
                      <DropdownMenuItem
                        key={a.key}
                        variant="destructive"
                        onSelect={() => runAction(a)}
                      >
                        <a.icon aria-hidden />
                        {a.label}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <button
              type="button"
              aria-label={t('close')}
              title={t('close')}
              onClick={() => requestClose()}
              className={cn(VIEWER_ICON_BUTTON, 'hidden sm:flex')}
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>

          {/* Медиа — заполняет доступную область (крупное отображение) */}
          <div
            ref={stageRef}
            className="relative flex flex-1 items-center justify-center overflow-hidden px-2 py-1 sm:px-4 sm:py-2"
            onClick={(e) => {
              e.stopPropagation()
              if (!menuJustClosed()) requestClose()
            }}
          >
            {/* Стрелки — полосы во всю высоту области медиа, шириной с прежнюю кнопку: целятся
            не в кружок, а «в край экрана», и промах по 40-пиксельной кнопке закрывал
            просмотр кликом по фону. Кружок прежнего размера — растёт только зона нажатия.
            На телефоне их нет, как в Telegram: там листают свайпом. */}
            {items.length > 1 && index > 0 && (
              <button
                type="button"
                aria-label={t('previous')}
                onClick={(e) => {
                  e.stopPropagation()
                  onIndexChange(index - 1)
                }}
                className="group absolute inset-y-0 left-0 z-10 hidden w-14 items-center justify-center sm:flex"
              >
                <span className="flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors group-hover:bg-white/20">
                  <ChevronLeft className="size-6" aria-hidden />
                </span>
              </button>
            )}

            {/* Обёртка без отступов: по ней меряем свободное место под повёрнутый снимок —
            у родителя они есть, и мерить по нему значило бы разрешить вылезти на них. */}
            <div
              ref={gestures.attachSurface}
              className="flex h-full min-h-0 w-full touch-none items-center justify-center"
            >
              <div
                ref={gestures.layerRef}
                className="flex h-full w-full items-center justify-center will-change-transform"
              >
                {!src ? (
                  media?.placeholder && !isVideo ? (
                    // Ссылка ещё едет, а силуэт снимка уже есть — показываем его, а не спиннер.
                    <img
                      src={media.placeholder}
                      alt=""
                      aria-hidden
                      width={media.width ?? undefined}
                      height={media.height ?? undefined}
                      className="h-full max-h-full w-auto max-w-full scale-105 object-contain blur-xl"
                    />
                  ) : (
                    <Loader2 className="size-8 animate-spin text-white/70" aria-hidden />
                  )
                ) : isVideo ? (
                  <VideoPlayer
                    src={src}
                    hls={media?.hls}
                    poster={pickSource(media?.poster, 1280)?.url}
                    autoPlay
                    inViewer
                    onVideoRef={setMedia}
                    onLoadedMetadata={measureFit}
                    videoStyle={transform}
                    // Повёрнутому кадру панель не нужна: она осталась бы горизонтальной поверх
                    // повёрнутой картинки. Воспроизведение поворот не прерывает.
                    controlsHidden={rotation % 360 !== 0}
                    videoClassName="rounded-lg transition-transform"
                  />
                ) : (
                  <img
                    ref={setMedia}
                    src={src}
                    // Копия по размеру экрана: 2048 на большом мониторе, оригинал — только если он
                    // шире всех копий. Скачивание по-прежнему отдаёт оригинал (downloadUrl).
                    // GIF — всегда оригиналом: копия была бы первым кадром.
                    srcSet={
                      cur.mime === 'image/gif'
                        ? undefined
                        : srcSetOf(media?.sources, { url: src, width: media?.width })
                    }
                    sizes={cur.mime === 'image/gif' ? undefined : '100vw'}
                    alt={cur.name ?? ''}
                    draggable={false}
                    // width/height задают пропорцию до загрузки — заглушка фоном ложится ровно в
                    // будущий кадр, а не на всю область.
                    width={media?.width ?? undefined}
                    height={media?.height ?? undefined}
                    style={
                      media?.placeholder
                        ? {
                            ...transform,
                            backgroundImage: `url("${media.placeholder}")`,
                            backgroundSize: '100% 100%',
                          }
                        : transform
                    }
                    onLoad={measureFit}
                    className="h-full max-h-full w-auto max-w-full object-contain transition-transform"
                    onClick={(e) => e.stopPropagation()}
                  />
                )}
              </div>
            </div>

            {items.length > 1 && index < items.length - 1 && (
              <button
                type="button"
                aria-label={t('next')}
                onClick={(e) => {
                  e.stopPropagation()
                  onIndexChange(index + 1)
                }}
                className="group absolute inset-y-0 right-0 z-10 hidden w-14 items-center justify-center sm:flex"
              >
                <span className="flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors group-hover:bg-white/20">
                  <ChevronRight className="size-6" aria-hidden />
                </span>
              </button>
            )}
          </div>

          {/* Подпись — снизу по центру, как в Telegram: длинная прокручивается в своих трёх
              строках, а не съедает кадр. */}
          {caption && (
            <div
              ref={footRef}
              className="relative z-10 flex justify-center px-4 pt-1 pb-[max(1rem,env(safe-area-inset-bottom))] duration-(--motion-modal) animate-in fade-in-0"
              onClick={(e) => e.stopPropagation()}
            >
              {caption}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/** Иконочная кнопка верхней панели: один размер и одни состояния у всех действий. */
/** Предел приближения снимка: дальше пиксели уже не дают деталей. */
const VIEWER_MAX_SCALE = 5

export const VIEWER_ICON_BUTTON =
  'flex size-9 shrink-0 items-center justify-center rounded-full text-white/80 transition-[color,background-color,opacity] hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-35'

/**
 * «Скачать» в просмотрщике — как у файла в Telegram Web: нажатие скачивает в приложение
 * (кольцо прогресса вокруг кнопки, повторное нажатие — отмена), готовое — второе нажатие
 * сохраняет на устройство (на телефоне — через «Поделиться → Сохранить»). Раньше ссылка
 * открывала файл новой вкладкой поверх приложения.
 */
function ViewerDownload({
  downloadKey,
  url,
  name,
  mime,
}: {
  downloadKey: string
  url: string
  name: string
  mime: string
}) {
  const t = useTranslations('Common')
  const download = useFileDownload(downloadKey, { url, name, mime })
  const { state } = download
  return (
    <button
      type="button"
      onClick={download.toggle}
      aria-label={
        state.status === 'loading'
          ? t('downloadCancel')
          : state.status === 'ready'
            ? t('save')
            : t('download')
      }
      title={
        state.status === 'error'
          ? t('downloadFailed')
          : state.status === 'loading'
            ? t('downloadCancel')
            : state.status === 'ready'
              ? t('save')
              : t('download')
      }
      className={cn(
        'relative flex size-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none',
        state.status === 'ready' ? 'text-white' : 'text-white/80 hover:text-white',
        state.status === 'error' && 'text-red-400',
      )}
    >
      {state.status === 'loading' ? (
        <>
          <X className="size-4" strokeWidth={2.5} aria-hidden />
          <ProgressRing progress={download.progress} />
        </>
      ) : state.status === 'ready' ? (
        <Save className="size-5" aria-hidden />
      ) : (
        <Download className="size-5" aria-hidden />
      )}
    </button>
  )
}
