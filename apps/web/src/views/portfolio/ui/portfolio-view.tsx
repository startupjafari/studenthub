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
  CardContent,
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

  // Группировка записей по виду, в фиксированном порядке секций.
  const byKind = useMemo(() => {
    const map = new Map<PortfolioKind, PortfolioItem[]>()
    for (const item of q.data ?? []) {
      const list = map.get(item.kind) ?? []
      list.push(item)
      map.set(item.kind, list)
    }
    return map
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

  const isEmpty = (q.data ?? []).length === 0

  return (
    <div className="flex w-full flex-col gap-6">
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
        <div className="flex flex-col gap-2">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
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
        <div className="flex flex-col gap-8">
          {PORTFOLIO_KINDS.filter((k) => byKind.has(k)).map((kind) => {
            const Icon = KIND_ICON[kind]
            return (
              <section key={kind} className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                    <Icon className="size-4" aria-hidden />
                    {t(kindKey(kind))}
                  </h2>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 text-muted-foreground"
                    onClick={() => setModal({ mode: 'create', kind })}
                  >
                    <Plus className="size-3.5" aria-hidden />
                    {t('add')}
                  </Button>
                </div>
                <ul className="flex flex-col gap-2">
                  {byKind.get(kind)!.map((item) => (
                    <li key={item.id}>
                      <ItemCard
                        item={item}
                        locale={locale}
                        onEdit={() => setModal({ mode: 'edit', item })}
                        onDelete={() => onDelete(item)}
                        t={t}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
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
  const period = formatPeriod(item, locale, t('present'))
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{item.title}</h3>
            <Badge variant="secondary" className="gap-1">
              <VisIcon className="size-3" aria-hidden />
              {t(visibilityKey(item.visibility))}
            </Badge>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {item.organization && <span>{item.organization}</span>}
            {item.organization && period && <span aria-hidden>·</span>}
            {period && <span>{period}</span>}
          </div>
          {item.description && (
            <p className="mt-1.5 whitespace-pre-line text-sm text-muted-foreground">
              {item.description}
            </p>
          )}
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <ExternalLink className="size-3" aria-hidden />
              {t('openLink')}
            </a>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" icon aria-label={t('actions')}>
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
      </CardContent>
    </Card>
  )
}
