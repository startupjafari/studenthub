'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  Eye,
  EyeOff,
  Globe,
  Inbox,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  ExternalLink,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  PageHeader,
  Skeleton,
  useConfirm,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import {
  deletePortfolioItem,
  fetchMyPortfolio,
  portfolioKeys,
  type PortfolioItem,
  type PortfolioKind,
  type PortfolioVisibility,
} from '../../../entities/portfolio'
import { KIND_ICON, PORTFOLIO_KINDS, kindKey, visibilityKey } from '../lib/visuals'
import { PortfolioItemModal } from './portfolio-item-modal'

const VIS_ICON: Record<PortfolioVisibility, typeof Globe> = {
  PRIVATE: EyeOff,
  UNIVERSITY: Eye,
  PUBLIC: Globe,
}

type ModalState = { mode: 'create'; kind?: PortfolioKind } | { mode: 'edit'; item: PortfolioItem }

// «Портфолио» студента (задача 21): секции по видам, приватность, CRUD.
export function PortfolioView() {
  const t = useTranslations('Portfolio')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [modal, setModal] = useState<ModalState | null>(null)

  const q = useQuery({ queryKey: portfolioKeys.mine(), queryFn: () => fetchMyPortfolio() })

  const remove = useMutation({
    mutationFn: (id: string) => deletePortfolioItem(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: portfolioKeys.mine() })
      toast.success(t('deleted'))
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  // Заголовков секций больше нет — записи идут одной сеткой плиток, как события.
  // Порядок сохраняем прежний, по видам: одинаковые записи стоят рядом, а сам вид
  // теперь виден на карточке (иконка и подпись), а не только в шапке секции.
  const items = useMemo(() => {
    const order = (k: PortfolioKind): number => PORTFOLIO_KINDS.indexOf(k)
    return [...(q.data ?? [])].sort((a, b) => order(a.kind) - order(b.kind))
  }, [q.data])

  async function onDelete(item: PortfolioItem) {
    const ok = await confirm({
      title: t('deleteTitle'),
      description: t('deleteConfirm', { title: item.title }),
      confirmLabel: t('delete'),
      destructive: true,
    })
    if (ok) remove.mutate(item.id)
  }

  const isEmpty = items.length === 0

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => setModal({ mode: 'create' })}>
            <Plus className="size-4" aria-hidden />
            {t('addItem')}
          </Button>
        }
      />

      {q.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      ) : q.isError ? (
        <EmptyState
          icon={<Inbox />}
          title={t('loadError')}
          action={<Button onClick={() => q.refetch()}>{t('retry')}</Button>}
        />
      ) : isEmpty ? (
        <EmptyState
          icon={<Plus />}
          title={t('empty')}
          description={t('emptyHint')}
          action={<Button onClick={() => setModal({ mode: 'create' })}>{t('addItem')}</Button>}
        />
      ) : (
        // Плитками, а не списком во всю ширину: у записи портфолио мало текста, и
        // растянутая на весь экран строка оставляла справа пустоту в пол-экрана.
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              locale={locale}
              onEdit={() => setModal({ mode: 'edit', item })}
              onDelete={() => onDelete(item)}
              t={t}
            />
          ))}
        </div>
      )}

      {modal?.mode === 'create' && (
        <PortfolioItemModal defaultKind={modal.kind} onClose={() => setModal(null)} />
      )}
      {modal?.mode === 'edit' && (
        <PortfolioItemModal item={modal.item} onClose={() => setModal(null)} />
      )}
    </div>
  )
}

function formatPeriod(item: PortfolioItem, locale: string, present: string): string | null {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { month: 'short', year: 'numeric' })
  if (item.startDate && item.endDate) return `${fmt(item.startDate)} — ${fmt(item.endDate)}`
  if (item.startDate) return `${fmt(item.startDate)} — ${present}`
  if (item.endDate) return fmt(item.endDate)
  return null
}

function ItemCard({
  item,
  locale,
  onEdit,
  onDelete,
  t,
}: {
  item: PortfolioItem
  locale: string
  onEdit: () => void
  onDelete: () => void
  t: ReturnType<typeof useTranslations>
}) {
  const VisIcon = VIS_ICON[item.visibility]
  const KindIcon = KIND_ICON[item.kind]
  const period = formatPeriod(item, locale, t('present'))

  return (
    <Card className="group/item relative gap-0 overflow-hidden py-0 transition-shadow hover:ring-ring/50">
      {/* Полоса-акцент сверху, как у карточки события: у приватной записи она приглушена —
          «только я» видно по краю карточки, не вчитываясь в бейдж. */}
      <span
        aria-hidden
        className={cn(
          'block h-1 w-full',
          item.visibility === 'PRIVATE' ? 'bg-muted-foreground/30' : 'bg-primary',
        )}
      />

      <div className="flex items-start gap-3 p-4">
        {/* Иконка вида записи: заголовков секций больше нет, и вид читается отсюда. */}
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <KindIcon className="size-5" aria-hidden />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 flex-1 text-sm leading-snug font-semibold">{item.title}</h3>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  icon
                  aria-label={t('actions')}
                  // Появляется по наведению и по фокусу: постоянное меню в углу каждой
                  // плитки — самый заметный элемент сетки, а нужно оно редко.
                  className="-mt-1 -mr-1 shrink-0 text-muted-foreground opacity-0 transition-opacity group-focus-within/item:opacity-100 group-hover/item:opacity-100 focus-visible:opacity-100"
                >
                  <MoreHorizontal className="size-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil aria-hidden />
                  {t('edit')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={onDelete}>
                  <Trash2 aria-hidden />
                  {t('delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {item.organization && (
            <p className="text-xs text-muted-foreground">{item.organization}</p>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            {/* Вид записи — первым бейджем: заголовков секций нет, и категория должна
                читаться на самой карточке, а не только по иконке слева. */}
            <Badge className="gap-1">
              <KindIcon className="size-3" aria-hidden />
              {t(kindKey(item.kind))}
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <VisIcon className="size-3" aria-hidden />
              {t(visibilityKey(item.visibility))}
            </Badge>
            {period && <Badge variant="outline">{period}</Badge>}
          </div>
        </div>
      </div>

      {item.description && (
        <p className="line-clamp-3 px-4 text-sm whitespace-pre-line text-muted-foreground">
          {item.description}
        </p>
      )}

      {/* Подвал прижат к низу: в сетке карточки разной высоты, и кнопки должны стоять
          на одной линии. Ссылка — кнопкой во всю ширину, как «Записаться» у события:
          это единственное действие карточки, и попадать по мелкой строке текста
          (особенно пальцем) неудобно. */}
      {item.url && (
        <div className="mt-auto p-4 pt-3">
          <Button asChild variant="outline" size="sm" className="w-full">
            <a href={item.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-3.5" aria-hidden />
              {t('openLink')}
            </a>
          </Button>
        </div>
      )}
    </Card>
  )
}
