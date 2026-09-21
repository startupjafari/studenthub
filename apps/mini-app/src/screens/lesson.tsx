import { useMainButton } from '../telegram/use-telegram'
import { haptic, webApp } from '../telegram/webapp'
import type { Lesson } from '../mocks/data'

interface Props {
  lesson: Lesson
}

/**
 * Детали пары. Экран существует не ради содержимого, а ради демонстрации связки
 * «BackButton в шапке + MainButton внизу»: ровно так Telegram ожидает переходы вглубь.
 */
export function LessonScreen({ lesson }: Props) {
  useMainButton('Записаться на консультацию', () => {
    haptic.success()
    const tg = webApp()
    if (tg) tg.showAlert('Демо: запись ушла бы в StudentHub')
    else alert('Демо: запись ушла бы в StudentHub')
  })

  return (
    <div className="screen">
      <header className="screen-head">
        <span className="badge">{lesson.kind}</span>
        <h1>{lesson.subject}</h1>
        <p className="hint">
          {lesson.startsAt} — {lesson.endsAt}
        </p>
      </header>

      <section className="list">
        <div className="row row-static">
          <span className="row-body">
            <span className="hint">Преподаватель</span>
            <b>{lesson.teacher}</b>
          </span>
        </div>
        <div className="row row-static">
          <span className="row-body">
            <span className="hint">Аудитория</span>
            <b>{lesson.room}</b>
          </span>
        </div>
        <div className="row row-static">
          <span className="row-body">
            <span className="hint">Формат</span>
            <b>{lesson.kind}</b>
          </span>
        </div>
      </section>

      <p className="footnote">
        Данные демонстрационные. Живое расписание появится, когда мини-апп научится подтверждать
        пользователя через initData.
      </p>
    </div>
  )
}
