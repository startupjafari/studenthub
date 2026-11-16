'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Download, FileWarning } from 'lucide-react'
import { Button, EmptyState, Modal, PageLoader } from '../../../shared/ui'
import { saveBlob } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import {
  documentTemplateKeys,
  downloadDocumentTemplateTest,
} from '../../../entities/document-template'
import { useTemplateTexts } from '../lib/use-template-texts'

interface TemplatePreviewModalProps {
  templateId: string
  versionId: string
  version: number
  onClose: () => void
}

type RenderState = 'pending' | 'done' | 'failed'

// Отступ вокруг страниц: при подгонке по ширине страница не должна касаться краёв окна.
const GUTTER_PX = 32

// Предпросмотр шаблона: тот же документ, что «Проверить на примере» (шаблон, заполненный
// демо-данными сервера), отрисованный в окне страницами Word. Рисует его docx-preview —
// библиотека грузится только при открытии окна, в общий бандл страницы не попадает.
export function TemplatePreviewModal({
  templateId,
  versionId,
  version,
  onClose,
}: TemplatePreviewModalProps) {
  const t = useTranslations('DocumentTemplates')
  const { errorToast } = useTemplateTexts()
  const scrollRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const styleRef = useRef<HTMLDivElement>(null)
  const [render, setRender] = useState<RenderState>('pending')

  // Документ формирует сервер — на каждое открытие окна заново (gcTime 0): пример дешёвый,
  // а держать в кэше DOCX с данными незачем.
  const file = useQuery({
    queryKey: [...documentTemplateKeys.detail(templateId), 'preview', versionId],
    queryFn: () => downloadDocumentTemplateTest(templateId, versionId),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  })

  useEffect(() => {
    const blob = file.data?.blob
    const body = bodyRef.current
    const styles = styleRef.current
    const scroller = scrollRef.current
    if (!blob || !body || !styles || !scroller) return

    let cancelled = false
    let observer: ResizeObserver | null = null
    setRender('pending')

    import('docx-preview')
      .then(({ renderAsync }) =>
        renderAsync(blob, body, styles, {
          inWrapper: true,
          breakPages: true,
          // Картинки — data: URL, а не blob: — после закрытия окна не остаётся висящих ссылок.
          useBase64URL: true,
          // Встроенный HTML (altChunk) библиотека вставляет как есть — в предпросмотре его не
          // рисуем. Правки и комментарии Word к бланку отношения не имеют.
          renderAltChunks: false,
          renderChanges: false,
          renderComments: false,
        }),
      )
      .then(() => {
        if (cancelled) return
        // Ссылки из документа в окне не нужны: это картинка бланка, а не навигация.
        body.querySelectorAll('a[href]').forEach((a) => a.removeAttribute('href'))

        // Подгонка по ширине: страница A4 шире телефона. Масштабируем обёртку целиком —
        // естественную ширину меряем один раз, до масштаба.
        const wrapper = body.querySelector<HTMLElement>('.docx-wrapper')
        const pages = Array.from(body.querySelectorAll<HTMLElement>('section.docx'))
        const natural = Math.max(0, ...pages.map((p) => p.offsetWidth))
        // Свой серый фон и отступы 30 px обёртка получает из стилей библиотеки — они вне слоёв
        // Tailwind и перебивают любой класс, поэтому перекрашиваем инлайном. Страницы остаются
        // белыми: это бумага.
        if (wrapper) {
          wrapper.style.background = 'transparent'
          wrapper.style.padding = '16px'
        }
        if (wrapper && natural > 0) {
          const fit = () => {
            const scale = Math.min(1, (scroller.clientWidth - GUTTER_PX) / natural)
            wrapper.style.zoom = String(Math.max(scale, 0.3))
          }
          fit()
          observer = new ResizeObserver(fit)
          observer.observe(scroller)
        }
        setRender('done')
      })
      .catch(() => {
        if (!cancelled) setRender('failed')
      })

    return () => {
      cancelled = true
      observer?.disconnect()
      body.replaceChildren()
      styles.replaceChildren()
    }
  }, [file.data])

  const download = () => {
    if (!file.data) return
    void saveBlob(file.data.blob, file.data.filename)
    toast.success(t('testDownloaded'))
  }

  const failed = file.isError || render === 'failed'

  return (
    <Modal
      onClose={onClose}
      title={t('previewTitle', { version })}
      size="3xl"
      height="tall"
      bodyClassName="overflow-hidden p-0"
      headerAction={
        <Button
          variant="outline"
          size="sm"
          disabled={!file.data}
          onClick={download}
          aria-label={t('previewDownload')}
        >
          <Download className="size-4" aria-hidden />
          {/* На телефоне — только значок: подпись съедала заголовок окна. */}
          <span className="hidden sm:inline">{t('previewDownload')}</span>
        </Button>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
          {t('previewHint')}
        </p>
        <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto bg-muted">
          {failed ? (
            <EmptyState
              icon={<FileWarning className="size-6" aria-hidden />}
              title={file.isError ? errorToast(file.error) : t('previewRenderError')}
              action={
                file.isError ? (
                  <Button variant="outline" onClick={() => void file.refetch()}>
                    {t('retry')}
                  </Button>
                ) : (
                  <Button variant="outline" onClick={download}>
                    <Download className="size-4" aria-hidden /> {t('previewDownload')}
                  </Button>
                )
              }
            />
          ) : (
            render !== 'done' && (
              <PageLoader label={t('previewLoading')} className="absolute inset-0" />
            )
          )}
          <div ref={styleRef} />
          <div ref={bodyRef} className={cn(render !== 'done' && 'invisible')} />
        </div>
      </div>
    </Modal>
  )
}
