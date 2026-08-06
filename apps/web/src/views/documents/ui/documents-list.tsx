'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { FolderLock, Plus, Search } from 'lucide-react'
import { DOCUMENT_CATEGORIES, DOCUMENT_STATUSES } from '@studenthub/shared-config'
import { documentKeys, fetchDocuments } from '../../../entities/document'
import {
  Button,
  EmptyState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '../../../shared/ui'
import { DocumentCard } from './document-card'
import { UploadWizard } from './upload-wizard'

type Sort = 'new' | 'old' | 'expiring' | 'title'
export type DocumentsPreset = 'active' | 'archived' | 'shared' | 'issued'

// Список документов: поиск + фильтры (категория/статус) + сортировка + загрузка (ТЗ §3).
// Пресеты shared/issued фильтруют активные документы на клиенте (доступ / выданные вузом).
export function DocumentsList({ preset }: { preset: DocumentsPreset }) {
  const t = useTranslations('Documents')
  const tErr = useTranslations('Errors')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string>('all')
  const [status, setStatus] = useState<string>('all')
  const [sort, setSort] = useState<Sort>('new')
  const [uploading, setUploading] = useState(false)

  const query = {
    view: preset === 'archived' ? ('archived' as const) : ('active' as const),
    sort,
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(category !== 'all' ? { category: category as 'PERSONAL' } : {}),
    ...(status !== 'all' ? { status: status as 'DRAFT' } : {}),
  }
  const q = useQuery({ queryKey: documentKeys.list(query), queryFn: () => fetchDocuments(query) })
  const docs = (q.data ?? []).filter((d) => {
    if (preset === 'shared') return d.accessCount > 0
    if (preset === 'issued') return d.issuedByUniversity || d.category === 'ISSUED_BY_UNIVERSITY'
    return true
  })
  const emptyKey =
    preset === 'archived'
      ? 'emptyArchive'
      : preset === 'shared'
        ? 'emptyShared'
        : preset === 'issued'
          ? 'emptyIssued'
          : 'emptyActive'

  return (
    <div className="flex flex-col gap-4">
      {/* Панель управления */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('search')}
            className="pl-9"
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger aria-label={t('category')} className="h-10 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allCategories')}</SelectItem>
            {DOCUMENT_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {t(`docCat_${c}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label={t('status')} className="h-10 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allStatuses')}</SelectItem>
            {DOCUMENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`docStatus_${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
          <SelectTrigger aria-label={t('sort')} className="h-10 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="new">{t('sortNew')}</SelectItem>
            <SelectItem value="old">{t('sortOld')}</SelectItem>
            <SelectItem value="expiring">{t('sortExpiring')}</SelectItem>
            <SelectItem value="title">{t('sortTitle')}</SelectItem>
          </SelectContent>
        </Select>
        {preset === 'active' && (
          <Button type="button" onClick={() => setUploading(true)}>
            <Plus className="size-4" aria-hidden /> {t('upload')}
          </Button>
        )}
      </div>

      {uploading && <UploadWizard onClose={() => setUploading(false)} />}

      {q.isLoading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full rounded-xl" />
          ))}
        </div>
      ) : q.isError ? (
        <p className="text-sm text-destructive">{tErr('INTERNAL_ERROR')}</p>
      ) : docs.length === 0 ? (
        <EmptyState icon={<FolderLock className="size-6" aria-hidden />} title={t(emptyKey)} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {docs.map((doc) => (
            <DocumentCard key={doc.id} doc={doc} />
          ))}
        </div>
      )}
    </div>
  )
}
