'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { ScrollText } from 'lucide-react'
import { auditKeys, fetchAudit } from '../../../entities/audit'
import { Card, CardContent, EmptyState, Input, Skeleton } from '../../../shared/ui'

export function AuditView() {
  const t = useTranslations('Moderation')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const [action, setAction] = useState('')

  const audit = useQuery({
    queryKey: auditKeys.list(action || undefined),
    queryFn: () => fetchAudit(action ? { action } : {}),
  })

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <h1 className="text-2xl font-bold">{t('auditTitle')}</h1>

      <Input
        value={action}
        onChange={(e) => setAction(e.target.value.trim())}
        placeholder={t('filterAction')}
        className="max-w-sm"
      />

      {audit.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : audit.isError ? (
        <EmptyState title={tErr('INTERNAL_ERROR')} />
      ) : (audit.data?.length ?? 0) === 0 ? (
        <EmptyState icon={<ScrollText className="size-6" aria-hidden />} title={t('auditEmpty')} />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">{t('colTime')}</th>
                  <th className="px-4 py-2 font-medium">{t('colAction')}</th>
                  <th className="px-4 py-2 font-medium">{t('colEntity')}</th>
                  <th className="px-4 py-2 font-medium">{t('colUser')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {audit.data!.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                      {new Date(r.createdAt).toLocaleString(locale, {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-2 font-medium">{r.action}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {r.entity
                        ? `${r.entity}${r.entityId ? ` · ${r.entityId.slice(0, 8)}` : ''}`
                        : '—'}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {r.userId ? r.userId.slice(0, 8) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
