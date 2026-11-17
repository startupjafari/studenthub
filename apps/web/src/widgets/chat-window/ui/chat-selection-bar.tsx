'use client'

import { useState, type ComponentType, type SVGProps } from 'react'
import { useTranslations } from 'next-intl'
import { Copy, Download, Flag, Forward, Loader2, Trash2 } from 'lucide-react'
import { MESSAGE_COMPLAINTS_MAX } from '@studenthub/shared-schemas'
import type { ChatMessage } from '../../../entities/chat'
import { ReportModal } from '../../../features/report-content'
import { cn } from '../../../shared/lib/utils'
import { downloadableAttachments, useSelectionDownload } from '../lib/use-selection-download'
import { useSelectionDelete } from './chat-header-selection'

/**
 * Низ режима выбора: панель действий и всё, что нужно только ей, — скачивание вложений и
 * жалоба на выбранные. Окну чата остаются общие с шапкой действия (переслать, копировать,
 * удалить), а эти два живут здесь целиком.
 */
export function ChatSelectionFooter({
  selected,
  myId,
  canReport,
  onForward,
  onCopy,
  onDelete,
  onDone,
}: {
  /** Выбранные сообщения в порядке ленты. */
  selected: readonly ChatMessage[]
  myId: string | undefined
  /** Роли можно жаловаться (COMPLAINT_REPORTER_ROLES). */
  canReport: boolean
  onForward: () => void
  onCopy: () => void
  /** Удалить свои из выбранных (подтверждение уже получено). */
  onDelete: () => void
  /** Действие завершено — выйти из режима выбора. */
  onDone: () => void
}) {
  const own = selected.filter((m) => m.senderId === myId).length
  // Жалуются на чужое и настоящее: своё, служебное и неотправленное обжаловать нечего.
  const reportable = canReport
    ? selected.filter((m) => m.senderId !== myId && !m.systemType && !m.id.startsWith('tmp:'))
    : []
  const files = downloadableAttachments(selected)
  const selectionDownload = useSelectionDownload()
  const [reportIds, setReportIds] = useState<string[] | null>(null)
  return (
    <>
      <ChatSelectionBar
        count={selected.length}
        ownCount={own}
        downloadCount={files.length}
        reportCount={reportable.length}
        downloading={selectionDownload.busy}
        onForward={onForward}
        onCopy={onCopy}
        onDownload={() => {
          void selectionDownload.download(selected).then(onDone)
        }}
        onReport={() =>
          // Сервер принимает до MESSAGE_COMPLAINTS_MAX за раз — берём первые по ленте.
          setReportIds(reportable.slice(0, MESSAGE_COMPLAINTS_MAX).map((m) => m.id))
        }
        onDelete={onDelete}
      />
      {reportIds && (
        <ReportModal
          targetType="MESSAGE"
          targetId={reportIds[0] ?? ''}
          messageIds={reportIds}
          preview={
            reportIds.length === 1
              ? selected.find((m) => m.id === reportIds[0])?.content || undefined
              : undefined
          }
          onClose={() => {
            setReportIds(null)
            onDone()
          }}
        />
      )}
    </>
  )
}

/**
 * Панель действий режима выбора — внизу, на месте поля ввода, как в Telegram
 * (MessageSelectToolbar): переслать, копировать, скачать медиа и файлы, пожаловаться,
 * удалить. Сверху в это время шапка выбора с «N сообщений» и «Отмена»
 * (ui/chat-header-selection), там же клавиши Esc / Delete / Ctrl+C.
 *
 * Пункт показывается, только если его есть к чему применить: «Удалить» — когда среди
 * выбранных есть свои, «Скачать» — когда есть вложения, «Пожаловаться» — когда есть чужие
 * и роли можно жаловаться. Пока ничего не выбрано, кнопки видны, но выключены: панель не
 * прыгает от первого выбранного сообщения.
 *
 * Телефон — плавающий остров, как и поле ввода; ПК — докованная плашка (её рисует родитель).
 */
function ChatSelectionBar({
  count,
  ownCount,
  downloadCount,
  reportCount,
  downloading,
  onForward,
  onCopy,
  onDownload,
  onReport,
  onDelete,
}: {
  count: number
  /** Сколько из выбранных — мои: удалить можно только их. */
  ownCount: number
  /** Сколько вложений у выбранных (0 — «Скачать» не показываем). */
  downloadCount: number
  /** Сколько выбранных можно обжаловать (чужие; 0 — «Пожаловаться» не показываем). */
  reportCount: number
  downloading: boolean
  onForward: () => void
  onCopy: () => void
  onDownload: () => void
  onReport: () => void
  /** Удалить (подтверждение спросит панель). */
  onDelete: () => void
}) {
  const t = useTranslations('Chats')
  const askDelete = useSelectionDelete(ownCount, onDelete)
  const none = count === 0
  return (
    <div
      role="toolbar"
      aria-label={t('tgListHeader.selectionActions')}
      // Метка для родителя: в режиме выбора он прячет всё, кроме этой панели.
      data-selection-footer=""
      className={cn(
        'pointer-events-auto flex items-stretch justify-around gap-1 duration-(--motion-page) animate-in fade-in-0 slide-in-from-bottom-2',
        // Тот же материал, что у поля ввода. Телефон — остров с рамкой и тенью; ПК — ряд
        // внутри докованной плашки родителя, без рамки и тени (§5.2: тень = «парит»).
        'material-island rounded-3xl border border-border/60 p-1 shadow-lg',
        'lg:rounded-none lg:border-0 lg:p-0 lg:shadow-none',
      )}
    >
      <BarButton icon={Forward} label={t('forward')} disabled={none} onClick={onForward} />
      <BarButton icon={Copy} label={t('copyText')} disabled={none} onClick={onCopy} />
      {downloadCount > 0 && (
        <BarButton
          icon={downloading ? Spinner : Download}
          label={t('download')}
          disabled={none || downloading}
          onClick={onDownload}
        />
      )}
      {reportCount > 0 && (
        <BarButton icon={Flag} label={t('report')} disabled={none} onClick={onReport} />
      )}
      {ownCount > 0 && (
        <BarButton icon={Trash2} label={t('delete')} danger disabled={none} onClick={askDelete} />
      )}
    </div>
  )
}

function Spinner(props: SVGProps<SVGSVGElement>) {
  return <Loader2 {...props} className={cn(props.className, 'animate-spin')} />
}

/**
 * Кнопка панели: значок с подписью под ним на телефоне (цель 44 px под палец), значок и
 * подпись в строку на ПК. Подпись видимая — она же доступное имя, без расхождений.
 */
function BarButton({
  icon: Icon,
  label,
  danger,
  disabled,
  onClick,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>
  label: string
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex min-h-11 min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-2xl px-2 py-1 text-[0.6875rem] font-medium transition-colors',
        'lg:flex-none lg:flex-row lg:gap-2 lg:rounded-xl lg:px-3 lg:text-sm',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-95',
        'disabled:pointer-events-none disabled:opacity-40',
        danger ? 'text-destructive hover:bg-destructive/10' : 'text-primary hover:bg-primary/10',
      )}
    >
      <Icon className="size-5 shrink-0" aria-hidden />
      <span className="max-w-full truncate">{label}</span>
    </button>
  )
}
