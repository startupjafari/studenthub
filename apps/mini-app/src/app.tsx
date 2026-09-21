import { useEffect, useState } from 'react'
import { useBackButton } from './telegram/use-telegram'
import { haptic, initTelegram } from './telegram/webapp'
import { ScheduleScreen } from './screens/schedule'
import { LessonScreen } from './screens/lesson'
import { TasksScreen } from './screens/tasks'
import { ProfileScreen } from './screens/profile'
import type { Lesson } from './mocks/data'

// Навигация — состоянием, без роутера.
//
// У мини-аппа нет адресной строки: Telegram открывает один URL, «назад» приходит
// системной кнопкой в шапке, а история браузера в WebView ведёт себя по-разному на iOS
// и Android. Три вкладки и один экран вглубь описываются состоянием честнее и без
// зависимости; когда экранов станет вдвое больше — придёт router, но не раньше.

type Tab = 'schedule' | 'tasks' | 'profile'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'schedule', label: 'Расписание', icon: '🗓' },
  { id: 'tasks', label: 'Задания', icon: '📘' },
  { id: 'profile', label: 'Профиль', icon: '👤' },
]

export function App() {
  const [tab, setTab] = useState<Tab>('schedule')
  const [lesson, setLesson] = useState<Lesson | null>(null)

  useEffect(() => initTelegram(), [])

  // Кнопка «Назад» нужна ровно на экране вглубь: на вкладках её место — закрыть мини-апп,
  // и этим занимается сам Telegram.
  useBackButton(lesson ? () => setLesson(null) : null)

  return (
    <div className="app">
      <main className="content">
        {lesson ? (
          <LessonScreen lesson={lesson} />
        ) : tab === 'schedule' ? (
          <ScheduleScreen onOpen={setLesson} />
        ) : tab === 'tasks' ? (
          <TasksScreen />
        ) : (
          <ProfileScreen />
        )}
      </main>

      {/* Вкладки прячутся на экране вглубь: две навигации одновременно — это не «удобнее». */}
      {!lesson && (
        <nav className="tabbar">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === tab ? 'tab tab-active' : 'tab'}
              onClick={() => {
                if (item.id !== tab) haptic.select()
                setTab(item.id)
              }}
            >
              <span className="tab-icon" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
        </nav>
      )}
    </div>
  )
}
