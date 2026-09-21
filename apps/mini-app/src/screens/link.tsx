import { useState } from 'react'
import { useMainButton } from '../telegram/use-telegram'
import { haptic } from '../telegram/webapp'
import { ApiError, linkAccount, type MiniUser } from '../api/client'

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

  useMainButton(code.length === CODE_LENGTH ? 'Привязать' : null, () => void submit())

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Привязка аккаунта</h1>
        <p className="hint">Мини-апп для администраторов и модераторов платформы</p>
      </header>

      <section className="card">
        <ol className="steps">
          <li>Откройте StudentHub в браузере, раздел «Настройки» → «Безопасность».</li>
          <li>Нажмите «Получить код» в блоке «Мини-апп в Telegram».</li>
          <li>Введите код здесь — он действует пять минут.</li>
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
        aria-label="Код привязки"
      />

      {error && <p className="hint hint-danger">{error}</p>}

      {/* Вне Telegram главной кнопки нет — нужна своя, иначе экран нечем подтвердить. */}
      <button type="button" className="fallback-submit" onClick={() => void submit()}>
        {pending ? 'Привязываем…' : 'Привязать'}
      </button>
    </div>
  )
}

/** Текст по коду ответа: `message` бэкенда пользователю не показываем. */
function message(cause: unknown): string {
  const code = cause instanceof ApiError ? cause.code : ''
  switch (code) {
    case 'BAD_REQUEST':
      return 'Код неверен или истёк. Получите новый в веб-версии'
    case 'CONFLICT':
      return 'Этот Telegram уже привязан к другому аккаунту'
    case 'UNAUTHORIZED':
      return 'Аккаунт не допущен в мини-апп'
    case 'RATE_LIMIT':
      return 'Слишком много попыток. Попробуйте позже'
    case 'NO_TELEGRAM':
      return 'Привязка возможна только из Telegram'
    default:
      return 'Не удалось привязать. Попробуйте ещё раз'
  }
}
