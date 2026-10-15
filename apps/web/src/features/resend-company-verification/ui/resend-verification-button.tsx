'use client'

import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { resendCompanyVerification } from '../../../entities/company'
import { Button } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'

interface ResendVerificationButtonProps {
  /** Адрес уже известен: только что зарегистрировались или вошли в кабинет. */
  email: string
  variant?: 'default' | 'outline' | 'ghost'
}

// «Отправить ещё раз» — для экранов, где адрес уже известен. После успеха кнопка гаснет:
// сервер шлёт письмо на каждый вызов, а лимит на эндпоинте жёсткий.
export function ResendVerificationButton({
  email,
  variant = 'outline',
}: ResendVerificationButtonProps) {
  const t = useTranslations('Employer')
  const tErr = useTranslations('Errors')
  const resend = useMutation({
    mutationFn: () => resendCompanyVerification(email),
    onSuccess: () => toast.success(t('resendSent')),
    onError: (error) => toast.error(tErr(toApiError(error).code)),
  })

  return (
    <Button
      size="sm"
      variant={variant}
      loading={resend.isPending}
      disabled={resend.isSuccess}
      onClick={() => resend.mutate()}
    >
      {resend.isSuccess ? t('resendDone') : t('resend')}
    </Button>
  )
}
