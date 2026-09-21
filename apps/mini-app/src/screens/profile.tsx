import { isTelegram, webApp } from '../telegram/webapp'
import { profile } from '../mocks/data'

/**
 * Профиль. Верх — данные StudentHub (моки), низ — то, что о пользователе сообщил сам
 * Telegram.
 *
 * Про `initDataUnsafe` в названии: клиент отдаёт разобранного пользователя без проверки
 * подписи, и доверять этим полям можно только для отрисовки. Любое решение «кто это и
 * что ему можно» принимается на бэкенде по подписи `initData` — здесь показываем имя,
 * и не более того.
 */
export function ProfileScreen() {
  const tgUser = webApp()?.initDataUnsafe.user

  return (
    <div className="screen">
      <header className="screen-head">
        <div className="avatar" aria-hidden="true">
          {profile.name.charAt(0)}
        </div>
        <h1>{profile.name}</h1>
        <p className="hint">
          {profile.group} · {profile.course} курс
        </p>
      </header>

      <section className="stats">
        <div className="stat">
          <b>{profile.gpa.toFixed(2)}</b>
          <span className="hint">GPA</span>
        </div>
        <div className="stat">
          <b>{profile.attendance}%</b>
          <span className="hint">Посещаемость</span>
        </div>
        <div className="stat">
          <b>{profile.course}</b>
          <span className="hint">Курс</span>
        </div>
      </section>

      <section className="list">
        <div className="row row-static">
          <span className="row-body">
            <span className="hint">Факультет</span>
            <b>{profile.faculty}</b>
          </span>
        </div>
        <div className="row row-static">
          <span className="row-body">
            <span className="hint">Аккаунт Telegram</span>
            <b>
              {tgUser
                ? `${tgUser.first_name}${tgUser.username ? ` · @${tgUser.username}` : ''}`
                : 'открыто вне Telegram'}
            </b>
          </span>
        </div>
      </section>

      {!isTelegram() && (
        <p className="footnote">
          Приложение открыто в обычном браузере: нативные кнопки, хаптика и тема Telegram недоступны
          — работает запасная светлая палитра.
        </p>
      )}
    </div>
  )
}
