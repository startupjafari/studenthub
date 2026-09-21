import { haptic } from '../telegram/webapp'
import { lessons, today, type Lesson } from '../mocks/data'

interface Props {
  onOpen: (lesson: Lesson) => void
}

export function ScheduleScreen({ onOpen }: Props) {
  const next = lessons.find((lesson) => lesson.isNext)

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Расписание</h1>
        <p className="hint">{today}</p>
      </header>

      {next && (
        <section className="card card-accent" onClick={() => onOpen(next)}>
          <span className="badge">Следующая пара</span>
          <h2>{next.subject}</h2>
          <p className="hint">
            {next.startsAt} — {next.endsAt} · {next.room}
          </p>
        </section>
      )}

      <section className="list">
        {lessons.map((lesson) => (
          <button
            key={lesson.id}
            type="button"
            className="row"
            onClick={() => {
              haptic.tap()
              onOpen(lesson)
            }}
          >
            <span className="row-time">
              <b>{lesson.startsAt}</b>
              <span className="hint">{lesson.endsAt}</span>
            </span>
            <span className="row-body">
              <b>{lesson.subject}</b>
              <span className="hint">
                {lesson.kind} · {lesson.room} · {lesson.teacher}
              </span>
            </span>
            <span className="row-chevron" aria-hidden="true">
              ›
            </span>
          </button>
        ))}
      </section>
    </div>
  )
}
