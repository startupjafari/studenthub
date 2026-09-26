'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { ChevronLeft, ChevronRight, Download, Loader2, RotateCw, X } from 'lucide-react'
import { useBackClose, useBodyScrollLock, useMediaGestures } from '../lib'
import { VideoPlayer } from './video-player'

export interface MediaViewerItem {
  mime: string
  name?: string | null
}

// Единый полноэкранный просмотрщик фото/видео (стиль чата): тёмный оверлей, медиа по центру,
// навигация ◀▶, поворот, скачивание, счётчик N/M. Закрытие по фону/Esc/крестику.
// Жесты (shared/lib/use-media-gestures): щипок и двойной тап приближают снимок, увеличенный
// возится пальцем, свайп поперёк листает. Видео играет наш VideoPlayer, а не системный
// плеер телефона; зум ему выключен — касания нужны контролам.
// Универсальный: URL текущего элемента резолвит вызывающий (src), слоты topLeft/caption/trailing
// позволяют доклеить контекст (отправитель, подпись, меню действий) — используется и в чате, и в профиле.
export function MediaViewer({
  items,
  index,
  src,
  onIndexChange,
  onClose,
  topLeft,
  caption,
  trailing,
  downloadUrl,
  downloadName,
  onContextMenuCapture,
}: {
  items: MediaViewerItem[]
  index: number
  /** Готовый URL текущего элемента; undefined — показываем спиннер (ленивая загрузка). */
  src?: string
  onIndexChange: (i: number) => void
  onClose: () => void
  topLeft?: ReactNode
  caption?: ReactNode
  trailing?: ReactNode
  downloadUrl?: string
  downloadName?: string | null
  onContextMenuCapture?: (e: React.MouseEvent) => void
}) {
  const t = useTranslations('Common')
  useBodyScrollLock()
  useBackClose(onClose)
  const [rotation, setRotation] = useState(0)
  // Масштаб «вписать повёрнутое»: поворот не меняет место, которое элемент занимает в
  // раскладке, поэтому у горизонтального снимка, повёрнутого на 90°, габарит становится
  // выше области просмотра и края уезжают под `overflow-hidden`. Считаем, во сколько раз
  // ужать, чтобы повёрнутый прямоугольник влез целиком.
  const [fit, setFit] = useState(1)
  // Callback-ref, а не объектный: один ref на <img> и <video> объектным пришлось бы
  // типизировать пересечением их интерфейсов — ложью, которую TS пропускает по случайности.
  const mediaRef = useRef<HTMLElement | null>(null)
  const setMedia = useCallback((el: HTMLImageElement | HTMLVideoElement | null): void => {
    mediaRef.current = el
  }, [])
  const cur = items[index]
  const isVideo = !!cur?.mime.startsWith('video/')
  // Слой зума живёт над медиа, поэтому поворот и вписывание снимка остаются его
  // собственной трансформацией и с жестом не конфликтуют.
  const gestures = useMediaGestures({
    content: mediaRef,
    zoomDisabled: isVideo,
    canPage: (direction) => (direction === 1 ? index < items.length - 1 : index > 0),
    onPage: (direction) => onIndexChange(index + direction),
  })
  const boxRef = gestures.surfaceRef
  const resetGestures = gestures.reset

  useEffect(() => setRotation(0), [index])

  // Новый кадр и поворот показываем в исходном масштабе: границы хода у них свои. `src` в
  // зависимостях не нужен — от подгрузки URL масштаб не меняется, а сброс посреди въезда
  // нового кадра оборвал бы его.
  useEffect(() => resetGestures(), [resetGestures, index, rotation])

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1)
      else if (e.key === 'ArrowRight' && index < items.length - 1) onIndexChange(index + 1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [index, items.length, onClose, onIndexChange])

  if (!cur || typeof document === 'undefined') return null
  const transform = { transform: `rotate(${rotation}deg) scale(${fit})` }
  const dl = downloadUrl ?? src

  return createPortal(
    <div
      // `pointer-events-auto` обязателен: просмотрщик рендерится порталом в body, а Radix
      // Dialog на время своей работы ставит body `pointer-events: none`, оставляя «живым»
      // только своё содержимое. Без этого поверх модалки картинка видна, но ни поворот,
      // ни скачивание, ни крестик не нажимаются.
      // Маркер для глобального Esc (shared/lib/use-escape-back): пока слой открыт,
      // Esc закрывает его, а не уводит на предыдущую страницу.
      data-overlay
      className="pointer-events-auto fixed inset-0 z-[100] flex select-none flex-col bg-black/80"
      onClick={(e) => {
        e.stopPropagation()
        onClose()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenuCapture?.(e)
      }}
    >
      {/* Верхняя панель: скачать + закрыть */}
      <div className="flex items-center justify-end gap-1 p-3" onClick={(e) => e.stopPropagation()}>
        {dl && (
          <a
            href={dl}
            download={downloadName ?? cur.name ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('download')}
            className="flex size-9 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Download className="size-5" aria-hidden />
          </a>
        )}
        <button
          type="button"
          aria-label={t('close')}
          onClick={onClose}
          className="flex size-9 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>

      {/* Медиа — заполняет доступную область (крупное отображение) */}
      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden px-2 py-1 sm:px-4 sm:py-2"
        onClick={onClose}
      >
        {/* Стрелки — полосы во всю высоту области медиа, шириной с прежнюю кнопку: целятся
            не в кружок, а «в край экрана», и промах по 40-пиксельной кнопке закрывал
            просмотр кликом по фону. Кружок прежнего размера — растёт только зона нажатия. */}
        {items.length > 1 && index > 0 && (
          <button
            type="button"
            aria-label={t('previous')}
            onClick={(e) => {
              e.stopPropagation()
              onIndexChange(index - 1)
            }}
            className="group absolute inset-y-0 left-0 z-10 flex w-14 items-center justify-center"
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors group-hover:bg-white/20">
              <ChevronLeft className="size-6" aria-hidden />
            </span>
          </button>
        )}

        {/* Обёртка без отступов: по ней меряем свободное место под повёрнутый снимок —
            у родителя они есть, и мерить по нему значило бы разрешить вылезти на них. */}
        <div
          ref={boxRef}
          className="flex h-full min-h-0 w-full touch-none items-center justify-center"
        >
          <div
            ref={gestures.layerRef}
            className="flex h-full w-full items-center justify-center will-change-transform"
          >
            {!src ? (
              <Loader2 className="size-8 animate-spin text-white/70" aria-hidden />
            ) : isVideo ? (
              <VideoPlayer
                src={src}
                autoPlay
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
                alt={cur.name ?? ''}
                draggable={false}
                style={transform}
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
            className="group absolute inset-y-0 right-0 z-10 flex w-14 items-center justify-center"
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors group-hover:bg-white/20">
              <ChevronRight className="size-6" aria-hidden />
            </span>
          </button>
        )}
      </div>

      {/* Нижняя панель: слева — контекст; по центру — подпись; справа — счётчик + поворот + доп.действия */}
      <div className="flex items-center gap-3 px-4 pb-4 pt-1" onClick={(e) => e.stopPropagation()}>
        {topLeft ?? <span />}

        <div className="flex min-w-0 flex-1 justify-center">{caption}</div>

        <div className="flex shrink-0 items-center gap-2">
          {items.length > 1 && (
            <span className="text-xs text-white/60 tabular-nums">
              {index + 1} / {items.length}
            </span>
          )}

          <button
            type="button"
            aria-label={t('rotate')}
            onClick={() => setRotation((r) => r + 90)}
            className="flex size-9 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            <RotateCw className="size-5" aria-hidden />
          </button>

          {trailing}
        </div>
      </div>
    </div>,
    document.body,
  )
}
