'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, Copy, KeyRound } from 'lucide-react'
import { Alert, AlertDescription, Button, Input, Label, Modal } from '../../../shared/ui'

// Токен агента показывается один раз — сразу после создания или перевыпуска. В базе только
// его хэш, повторно его не получить: закрыл окно не скопировав — перевыпуск.
export function AgentTokenModal({
  agentName,
  token,
  onClose,
}: {
  agentName: string
  token: string
  onClose: () => void
}) {
  const t = useTranslations('Cameras')
  const [copied, setCopied] = useState(false)

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
    } catch {
      // Буфер обмена недоступен (не HTTPS, запрет браузера) — токен выделяется в поле вручную.
      setCopied(false)
    }
  }

  return (
    <Modal onClose={onClose} title={t('tokenTitle', { name: agentName })} size="lg">
      <div className="flex flex-col gap-4">
        <Alert variant="warning">
          <KeyRound aria-hidden />
          <AlertDescription>{t('tokenOnce')}</AlertDescription>
        </Alert>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="agent-token">{t('tokenLabel')}</Label>
          <div className="flex gap-2">
            <Input
              id="agent-token"
              readOnly
              value={token}
              onFocus={(e) => e.currentTarget.select()}
              className="font-mono text-xs"
            />
            <Button type="button" variant="outline" onClick={() => void copy()}>
              {copied ? (
                <Check className="size-4" aria-hidden />
              ) : (
                <Copy className="size-4" aria-hidden />
              )}
              {copied ? t('copied') : t('copy')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('tokenHint')}</p>
        </div>
        <div className="flex justify-end">
          <Button type="button" onClick={onClose}>
            {t('tokenDone')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
