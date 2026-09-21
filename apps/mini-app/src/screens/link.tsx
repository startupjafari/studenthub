import { useState } from 'react'
import { useMainButton } from '../telegram/use-telegram'
import { haptic } from '../telegram/webapp'
import { ApiError, linkAccount, type MiniUser } from '../api/client'
import { t } from '../i18n'

// Экран привязки.
//
// Показывается всегда, когда сессию открыть не удалось, — и это следствие того, что сервер
// намеренно отвечает одинаковым «нет доступа» и на «Telegram не привязан», и на «роль не
// та» (по разнице ответов вычислялось бы, кто из админов привязан). Различить причины
// клиент не может, поэтому предлагает единственное действие, которое способно помочь:
// ввести код. Если доступа нет в принципе, код просто не подойдёт.

const CODE_LENGTH = 8

export function LinkScreen({ onLinked }: { onLinked: (user: MiniUser) => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const submit = async () => {
    if (code.length !== CODE_LENGTH || pending) return
    setPending(true)
    setError(null)
    try {
      const user = await linkAccount(code)
      haptic.success()
      onLinked(user)
    } catch (cause) {
      setError(message(cause))
      setCode('')
    } finally {
      setPending(false)
    }
  }

  useMainButton(code.length === CODE_LENGTH ? t('linkSubmit') : null, () => void submit())

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>{t('linkTitle')}</h1>
        <p className="hint">{t('linkSubtitle')}</p>
      </header>

      <section className="card">
        <ol className="steps">
          <li>{t('linkStep1')}</li>
          <li>{t('linkStep2')}</li>
          <li>{t('linkStep3')}</li>
        </ol>
      </section>

      <input
        className="code-input"
        value={code}
        onChange={(event) => {
          // Код диктуют и набирают с экрана: приводим к верхнему регистру и отбрасываем
          // всё, чего в алфавите кода нет, вместо того чтобы ругаться на ввод.
          const cleaned = event.target.value
            .toUpperCase()
            .replace(/[^A-Z2-9]/g, '')
            .slice(0, CODE_LENGTH)
          setCode(cleaned)
          if (error) setError(null)
        }}
        inputMode="text"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        placeholder="XXXXXXXX"
        aria-label={t('linkCodeLabel')}
      />

      {error && <p className="hint hint-danger">{error}</p>}

      {/* Вне Telegram главной кнопки нет — нужна своя, иначе экран нечем подтвердить. */}
      <button type="button" className="fallback-submit" onClick={() => void submit()}>
        {pending ? t('linkPending') : t('linkSubmit')}
      </button>
    </div>
  )
}

/** Текст по коду ответа: `message` бэкенда пользователю не показываем. */
function message(cause: unknown): string {
  const code = cause instanceof ApiError ? cause.code : ''
  switch (code) {
    case 'BAD_REQUEST':
      return t('linkErrBadCode')
    case 'CONFLICT':
      return t('linkErrConflict')
    case 'UNAUTHORIZED':
      return t('linkErrForbidden')
    case 'RATE_LIMIT':
      return t('linkErrRateLimit')
    case 'NO_TELEGRAM':
      return t('linkErrNoTelegram')
    default:
      return t('linkErrUnknown')
  }
}
