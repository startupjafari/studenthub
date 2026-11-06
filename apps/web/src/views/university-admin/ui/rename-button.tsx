'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Pencil } from 'lucide-react'
import { Button, PromptDialog } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'

interface RenameButtonProps {
  /** Текущее название — с него начинается правка. */
  name: string
  title: string
  save: (name: string) => Promise<unknown>
  onSaved: () => void
}

// Переименование справочника одной кнопкой: у факультета и специальности, кроме названия,
// менять нечего, и отдельная форма ради одного поля была бы лишней.
export function RenameButton({ name, title, save, onSaved }: RenameButtonProps) {
  const t = useTranslations('UniAdmin')
  const tErr = useTranslations('Errors')
  const [open, setOpen] = useState(false)
  const rename = useMutation({
    mutationFn: save,
    onSuccess: () => {
      toast.success(t('renamed'))
      onSaved()
    },
    onError: (e) => {
      const code = toApiError(e).code
      toast.error(code === 'CONFLICT' ? t('nameTaken') : tErr(code))
    },
  })

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        icon
        aria-label={t('rename')}
        title={t('rename')}
        loading={rename.isPending}
        onClick={() => setOpen(true)}
        className="text-muted-foreground"
      >
        <Pencil className="size-4" aria-hidden />
      </Button>
      <PromptDialog
        open={open}
        title={title}
        defaultValue={name}
        required
        submitLabel={t('save')}
        cancelLabel={t('cancel')}
        onSubmit={(value) => {
          const next = value.trim()
          if (next && next !== name) rename.mutate(next)
          setOpen(false)
        }}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
