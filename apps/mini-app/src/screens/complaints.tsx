import { useCallback, useEffect, useState } from 'react'
import { fetchOpenComplaints, type Complaint, type ComplaintPage } from '../api/complaints'

// Очередь модерации — то, ради чего мини-апп существует: разобрать жалобу с телефона,
// не дожидаясь возвращения к столу.
//
// Порядок строк задаёт сервер: необработанные раньше, внутри — по приоритету, внутри —
// свежие. Своей сортировки здесь нет намеренно, иначе очередь в телефоне и очередь в
// веб-админке разъехались бы, и двое модераторов разбирали бы разное.

const PRIORITY_LABEL: Record<Complaint['priority'], string> = {
  HIGH: 'Срочно',
  MEDIUM: 'Обычная',
  LOW: 'Не срочно',
}

const TARGET_LABEL: Record<Complaint['targetType'], string> = {
  USER: 'На пользователя',
  MESSAGE: 'На сообщение',
  POST: 'На пост',
  STORY: 'На историю',
  COMMENT: 'На комментарий',
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; page: ComplaintPage }
  | { status: 'error'; message: string }

export function ComplaintsScreen() {
  const [state, setState] = useState<State>({ status: 'loading' })

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      setState({ status: 'ready', page: await fetchOpenComplaints() })
    } catch {
      setState({ status: 'error', message: 'Не удалось загрузить очередь' })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Жалобы</h1>
        <p className="hint">
          {state.status === 'ready' ? queueSummary(state.page.total) : 'Очередь модерации'}
        </p>
      </header>

      {state.status === 'loading' && <SkeletonList />}

      {state.status === 'error' && (
        <section className="card">
          <p>{state.message}</p>
          <button type="button" className="fallback-submit" onClick={() => void load()}>
            Повторить
          </button>
        </section>
      )}

      {state.status === 'ready' && state.page.items.length === 0 && (
        <section className="card">
          <h2>Разобрано</h2>
          <p className="hint">Необработанных жалоб нет.</p>
        </section>
      )}

      {state.status === 'ready' && state.page.items.length > 0 && (
        <section className="list">
          {state.page.items.map((complaint) => (
            // Карточка с разбором и решением — следующий шаг; пока строка не
            // притворяется кликабельной, чтобы тап не оставался без ответа.
            <div key={complaint.id} className="row row-static">
              <span className="row-body">
                <b>{TARGET_LABEL[complaint.targetType]}</b>
                {/* Текст жалобы — чужие слова о третьем лице: показываем первую строку,
                    целиком он читается на карточке, где рядом есть контекст. */}
                <span className="hint">{firstLine(complaint.reason)}</span>
                <span className="hint">
                  {PRIORITY_LABEL[complaint.priority]} · {formatDate(complaint.createdAt)}
                </span>
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

/** «12 в очереди» вместо «Всего: 12» — формулировка, а не подпись к числу. */
function queueSummary(total: number): string {
  if (total === 0) return 'Очередь пуста'
  const last = total % 10
  const teen = total % 100 >= 11 && total % 100 <= 14
  const word = !teen && last === 1 ? 'жалоба' : !teen && last >= 2 && last <= 4 ? 'жалобы' : 'жалоб'
  return `${total} ${word} в очереди`
}

function firstLine(reason: string): string {
  const line = reason.split('\n')[0] ?? ''
  return line.length > 90 ? `${line.slice(0, 90)}…` : line
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  return sameDay
    ? date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

function SkeletonList() {
  // Скелетон, а не спиннер: высота строк известна заранее, и список не прыгает,
  // когда данные приезжают.
  return (
    <section className="list" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="row row-static">
          <span className="row-body">
            <span className="skeleton skeleton-title" />
            <span className="skeleton skeleton-line" />
          </span>
        </div>
      ))}
    </section>
  )
}
