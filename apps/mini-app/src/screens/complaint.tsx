import { useCallback, useEffect, useState } from 'react'
import {
  fetchComplaint,
  resolveComplaint,
  type Complaint,
  type ResolveAction,
} from '../api/complaints'
import { ApiError } from '../api/client'
import { confirmAction, haptic } from '../telegram/webapp'
import { useBackButton } from '../telegram/use-telegram'

// Карточка разбора жалобы: прочитать целиком и принять решение с телефона.
//
// Решений три, поэтому MainButton здесь не используется: она одна, а выбор между «снять
// контент», «заблокировать» и «отклонить» — это и есть работа модератора. Кнопки стоят
// в потоке, разрушительные отличаются цветом.

const TARGET_LABEL: Record<Complaint['targetType'], string> = {
  USER: 'на пользователя',
  MESSAGE: 'на сообщение',
  POST: 'на пост',
  STORY: 'на историю',
  COMMENT: 'на комментарий',
}

const PRIORITY_LABEL: Record<Complaint['priority'], string> = {
  HIGH: 'Срочно',
  MEDIUM: 'Обычная',
  LOW: 'Не срочно',
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; complaint: Complaint }
  | { status: 'error'; message: string }

export function ComplaintScreen({ id, onBack }: { id: string; onBack: () => void }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useBackButton(onBack)

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      setState({ status: 'ready', complaint: await fetchComplaint(id) })
    } catch {
      setState({ status: 'error', message: 'Не удалось открыть жалобу' })
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const decide = useCallback(
    async (action: ResolveAction, question: string) => {
      if (busy) return
      if (!(await confirmAction(question))) return

      setBusy(true)
      setError(null)
      try {
        await resolveComplaint(id, action)
        haptic.success()
        // Возвращаемся в очередь: разобранной жалобы в ней уже нет, и оставаться
        // на карточке, которая больше ничего не ждёт, незачем.
        onBack()
      } catch (err) {
        // Текст от сервера: он знает, почему нельзя (например, «жалоба уже обработана»
        // другим модератором), а выдумывать свою формулировку значило бы врать.
        setError(err instanceof ApiError ? err.message : 'Не удалось применить решение')
      } finally {
        setBusy(false)
      }
    },
    [busy, id, onBack],
  )

  if (state.status === 'loading') {
    return (
      <div className="screen">
        <header className="screen-head">
          <h1>Жалоба</h1>
          <p className="hint">Открываем…</p>
        </header>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="screen">
        <header className="screen-head">
          <h1>Жалоба</h1>
        </header>
        <section className="card">
          <p>{state.message}</p>
          <button type="button" className="fallback-submit" onClick={() => void load()}>
            Повторить
          </button>
        </section>
      </div>
    )
  }

  const { complaint } = state
  const isUser = complaint.targetType === 'USER'

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Жалоба {TARGET_LABEL[complaint.targetType]}</h1>
        <p className="hint">
          {PRIORITY_LABEL[complaint.priority]} · {formatDate(complaint.createdAt)}
        </p>
      </header>

      <section className="card">
        <h2>Что написали</h2>
        {/* Текст жалобы целиком: в очереди видна только первая строка, а решение
            принимается по всему тексту. */}
        <p>{complaint.reason}</p>
        <p className="hint">
          {complaint.reporter
            ? `Пожаловался: ${complaint.reporter.lastName} ${complaint.reporter.firstName}`
            : 'Автор жалобы удалён'}
        </p>
      </section>

      {error && (
        <section className="card">
          <p className="hint-danger">{error}</p>
        </section>
      )}

      <section className="card">
        <h2>Решение</h2>
        {/* Для жалобы на пользователя удаление контента недопустимо — правило сервера,
            и кнопку здесь просто не рисуем, чтобы не предлагать заведомый отказ. */}
        {!isUser && (
          <button
            type="button"
            className="fallback-submit danger"
            disabled={busy}
            onClick={() =>
              void decide('DELETE_CONTENT', 'Снять контент? Автор его больше не увидит.')
            }
          >
            Снять контент
          </button>
        )}
        <button
          type="button"
          className="fallback-submit danger"
          disabled={busy}
          onClick={() =>
            void decide('BLOCK_USER', 'Заблокировать пользователя? Он потеряет доступ к платформе.')
          }
        >
          Заблокировать автора
        </button>
        <button
          type="button"
          className="fallback-submit"
          disabled={busy}
          onClick={() => void decide('DISMISS', 'Отклонить жалобу? Нарушения нет.')}
        >
          Нарушения нет
        </button>
      </section>
    </div>
  )
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  const sameDay = date.toDateString() === new Date().toDateString()
  return date.toLocaleString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    ...(sameDay ? {} : { day: 'numeric', month: 'short' }),
  })
}
