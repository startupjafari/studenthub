// Прогресс и итоговый отчёт.
//
// Зачем отдельный модуль: на полном масштабе прогон идёт десятки минут, и без строк
// «вуз 37/100, 4.2 млн строк, 18k строк/с, осталось ~22 мин» невозможно отличить
// «работает медленно» от «повисло на блокировке».

const fmt = new Intl.NumberFormat('ru-RU')

function duration(ms) {
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec} с`
  const min = Math.floor(sec / 60)
  return `${min} мин ${String(sec % 60).padStart(2, '0')} с`
}

export function createProgress({ total, label }) {
  const startedAt = Date.now()
  let done = 0
  let rows = 0

  return {
    // Вызывается после каждого готового вуза.
    step(name, stepRows) {
      done += 1
      rows += stepRows
      const elapsed = Date.now() - startedAt
      const perSec = Math.round(rows / Math.max(elapsed / 1000, 1))
      const eta = done < total ? (elapsed / done) * (total - done) : 0
      const parts = [
        `[${done}/${total}]`,
        name,
        `+${fmt.format(stepRows)} строк`,
        `всего ${fmt.format(rows)}`,
        `${fmt.format(perSec)} строк/с`,
      ]
      if (eta > 0) parts.push(`осталось ~${duration(eta)}`)
      console.log(parts.join(' · '))
    },

    addRows(n) {
      rows += n
    },

    // Пропущенный вуз (маркер уже стоит) — не портит статистику скорости.
    skip(name) {
      done += 1
      console.log(`[${done}/${total}] ${name} · уже залит, пропуск`)
    },

    report(counts) {
      const elapsed = Date.now() - startedAt
      console.log(`\n${label}: ${fmt.format(rows)} строк за ${duration(elapsed)}`)
      const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
      for (const [model, count] of entries) {
        console.log(`  ${model.padEnd(28)} ${fmt.format(count).padStart(12)}`)
      }
    },

    get rows() {
      return rows
    },
  }
}

export { duration, fmt }
