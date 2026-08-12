'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import {
  AlertTriangle,
  CalendarClock,
  ChevronRight,
  ClipboardList,
  FileText,
  Inbox,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge, Card, CardContent, CardHeader, CardTitle } from '../../../shared/ui'
import type { AttentionItem, AttentionKind, AttentionPriority } from '../lib/attention'
import { groupByPriority } from '../lib/attention'

const KIND_ICON: Record<AttentionKind, LucideIcon> = {
  correctApplication: FileText,
  draftApplication: FileText,
  eventToday: CalendarClock,
  eventSoon: CalendarClock,
  assignmentDue: ClipboardList,
  assignmentFix: ClipboardList,
  assignmentOverdue: ClipboardList,
}

const PRIORITY_BADGE: Record<AttentionPriority, 'destructive' | 'warning' | 'secondary'> = {
  urgent: 'destructive',
  today: 'warning',
  soon: 'secondary',
}

const PRIORITY_ORDER: AttentionPriority[] = ['urgent', 'today', 'soon']

interface AttentionListProps {
  items: AttentionItem[]
}

// «Требует внимания» — сгруппировано по приоритету (Срочно / Сегодня / Скоро).
export function AttentionList({ items }: AttentionListProps) {
  const t = useTranslations('Today')
  const groups = groupByPriority(items)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="size-4 text-primary" aria-hidden />
          {t('attention')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 py-6 text-center">
            <Inbox className="size-7 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">{t('attentionEmpty')}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {PRIORITY_ORDER.filter((p) => groups[p].length > 0).map((p) => (
              <div key={p} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant={PRIORITY_BADGE[p]}>{t(`priority.${p}`)}</Badge>
                </div>
                <ul className="flex flex-col gap-1.5">
                  {groups[p].map((item) => {
                    const Icon = KIND_ICON[item.kind]
                    return (
                      <li key={item.id}>
                        <Link
                          href={item.href}
                          className="flex items-center gap-3 rounded-lg border border-border bg-card p-2.5 transition-colors hover:bg-muted/50"
                        >
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                            <Icon className="size-4" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{item.title}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {t(`kind.${item.kind}`)}
                              {item.meta ? ` · ${item.meta}` : ''}
                            </span>
                          </span>
                          <ChevronRight
                            className="size-4 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
