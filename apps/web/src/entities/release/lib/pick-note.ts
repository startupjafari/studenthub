import type { ReleaseNote } from '../model/types'
import type { ReleaseState } from '../model/state'
import { isNewerVersion } from './compare-versions'

export interface ReleaseDecision {
  note: ReleaseNote
  /**
   * `show` — открыть окно; `acknowledge` — молча записать версию прочитанной.
   *
   * Второе нужно для тех, кто зарегистрировался после выхода релиза: рассказывать
   * человеку, что изменилось в продукте, которого он ещё не видел, — бессмыслица. Но и
   * оставлять отметку пустой нельзя, иначе окно всплывёт на следующем релизе дважды.
   */
  action: 'show' | 'acknowledge'
}

/** Самая новая нота вообще — её открывает пункт «Что нового» в настройках. */
export function latestNote(notes: ReleaseNote[]): ReleaseNote | null {
  if (notes.length === 0) return null
  return notes.reduce((latest, n) => (isNewerVersion(n.version, latest.version) ? n : latest))
}

/** Последняя нота, у которой включён показ окна. История длиннее — она для changelog. */
export function latestModalNote(notes: ReleaseNote[]): ReleaseNote | null {
  const shown = notes.filter((n) => n.showModal)
  if (shown.length === 0) return null
  return shown.reduce((latest, n) => (isNewerVersion(n.version, latest.version) ? n : latest))
}

/**
 * Что делать с окном «Что нового» при текущем состоянии сервера.
 *
 * `state === undefined` — ответ ещё не пришёл: молчим. Показать окно и тут же убрать его,
 * когда выяснится, что человек всё читал, хуже, чем показать на полсекунды позже.
 */
export function pickReleaseNote(
  notes: ReleaseNote[],
  state: ReleaseState | undefined,
): ReleaseDecision | null {
  const note = latestModalNote(notes)
  if (!note || !state) return null

  // Эту версию (или более новую) человек уже подтвердил.
  if (state.version && !isNewerVersion(note.version, state.version)) return null

  const registered = state.accountCreatedAt ? Date.parse(state.accountCreatedAt) : Number.NaN
  const released = Date.parse(`${note.date}T00:00:00Z`)
  if (!Number.isNaN(registered) && !Number.isNaN(released) && registered >= released) {
    return { note, action: 'acknowledge' }
  }

  return { note, action: 'show' }
}
