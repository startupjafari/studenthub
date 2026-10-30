'use client'

import { useTranslations } from 'next-intl'
import type { LibraryReader } from '@studenthub/shared-schemas'
import { Avatar, AvatarFallback, AvatarImage, Card } from '../../../shared/ui'

/**
 * Читатель глазами библиотеки: фото, ФИО, группа, № билета, статус. Узкая карточка, как у
 * охраны: даты рождения, формы оплаты и общежития здесь нет (docs/PROJECT.md §3.11).
 */
export function ReaderCard({
  reader,
  children,
}: {
  reader: LibraryReader
  children?: React.ReactNode
}) {
  const t = useTranslations('LibraryDesk')
  const initials = `${reader.lastName[0] ?? ''}${reader.firstName[0] ?? ''}`
  const facts = [
    reader.group ? { label: t('group'), value: reader.group } : null,
    reader.course ? { label: t('course'), value: String(reader.course) } : null,
    reader.faculty ? { label: t('faculty'), value: reader.faculty } : null,
    reader.studentCardNumber ? { label: t('cardNumber'), value: reader.studentCardNumber } : null,
    reader.academicStatus ? { label: t('academicStatus'), value: reader.academicStatus } : null,
  ].filter((f): f is { label: string; value: string } => f !== null)
  return (
    <Card className="flex-row items-start gap-4 p-4">
      {/* Фото крупно: по нему библиотекарь сверяет, что перед ним тот самый человек. */}
      <Avatar className="size-24 rounded-xl">
        {reader.avatarUrl && <AvatarImage src={reader.avatarUrl} alt="" className="object-cover" />}
        <AvatarFallback className="rounded-xl text-xl">{initials}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-lg font-semibold leading-tight">
          {[reader.lastName, reader.firstName, reader.middleName].filter(Boolean).join(' ')}
        </p>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {facts.map((f) => (
            <div key={f.label} className="flex gap-2">
              <dt className="text-muted-foreground">{f.label}</dt>
              <dd className="min-w-0 truncate">{f.value}</dd>
            </div>
          ))}
        </dl>
        {children}
      </div>
    </Card>
  )
}
