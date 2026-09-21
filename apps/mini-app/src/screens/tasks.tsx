import { haptic } from '../telegram/webapp'
import { assignments } from '../mocks/data'

export function TasksScreen() {
  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Задания</h1>
        <p className="hint">{assignments.length} активных</p>
      </header>

      <section className="list">
        {assignments.map((task) => (
          <button key={task.id} type="button" className="row" onClick={() => haptic.select()}>
            <span className="row-body">
              <b>{task.title}</b>
              <span className={task.overdue ? 'hint hint-danger' : 'hint'}>
                {task.subject} · {task.dueLabel}
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
