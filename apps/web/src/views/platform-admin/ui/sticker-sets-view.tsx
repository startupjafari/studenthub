'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Plus, RotateCcw, Sticker } from 'lucide-react'
import {
  fetchAdminStickerSets,
  reorderPatches,
  stickerSetKeys,
  updateStickerSetRequest,
  type AdminStickerSet,
} from '../../../entities/sticker-set'
import { Button, EmptyState, PageHeader, Skeleton } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib/api-error'
import { StickerSetCard } from './sticker-set-card'
import { StickerSetFormModal } from './sticker-set-form-modal'

// Картинки — подписанные ссылки на 10–15 минут: держим список свежим не дольше пяти.
const STALE_MS = 5 * 60 * 1000

/**
 * Каталог стикеров чатов (docs/PROJECT.md «Стикеры»): наборы заводит, наполняет и публикует
 * только админ платформы — каталог видят все пользователи всех вузов. Новый набор создаётся
 * неопубликованным; в выдаче клиентам наборы идут по `order`.
 */
export function StickerSetsView() {
  const t = useTranslations('StickerAdmin')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [renaming, setRenaming] = useState<AdminStickerSet | null>(null)

  const sets = useQuery({
    queryKey: stickerSetKeys.admin(),
    queryFn: fetchAdminStickerSets,
    staleTime: STALE_MS,
  })
  const list = sets.data ?? []

  // Перенос — несколько PATCH `order` (обычно два соседа). Потом перечитываем список:
  // так порядок на экране — ровно серверный, даже если часть запросов не прошла.
  const move = useMutation({
    mutationFn: async ({ from, to }: { from: number; to: number }) => {
      const patches = reorderPatches(list, from, to)
      await Promise.all(patches.map((p) => updateStickerSetRequest(p.id, { order: p.order })))
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
    onSettled: () => qc.invalidateQueries({ queryKey: stickerSetKeys.admin() }),
  })

  const createButton = (
    <Button size="md" onClick={() => setCreateOpen(true)}>
      <Plus className="size-4" aria-hidden />
      {t('add')}
    </Button>
  )

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader title={t('title')} subtitle={t('subtitle')} actions={createButton} />

      {createOpen && <StickerSetFormModal onClose={() => setCreateOpen(false)} />}
      {renaming && <StickerSetFormModal set={renaming} onClose={() => setRenaming(null)} />}

      {sets.isLoading ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label={tCommon('loading')}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44 w-full rounded-xl" />
          ))}
        </div>
      ) : sets.isError ? (
        <EmptyState
          title={t('loadError')}
          action={
            <Button variant="outline" size="md" onClick={() => void sets.refetch()}>
              <RotateCcw className="size-4" aria-hidden />
              {tCommon('retry')}
            </Button>
          }
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Sticker className="size-6" aria-hidden />}
          title={t('empty')}
          description={t('emptyHint')}
          action={createButton}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {list.map((set, index) => (
            <StickerSetCard
              key={set.id}
              set={set}
              canMoveUp={index > 0}
              canMoveDown={index < list.length - 1}
              moving={move.isPending}
              onMove={(direction) => move.mutate({ from: index, to: index + direction })}
              onRename={() => setRenaming(set)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
