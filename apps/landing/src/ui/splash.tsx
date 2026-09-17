import { GraduationCap } from 'lucide-react'

/**
 * Заставка запуска: тёмное полотно с логотипом, сквозь которое «проваливаешься» на сайт.
 *
 * Тот же приём, что в платформе, перенесён правилами CSS и своим компонентом, а не
 * импортом (LANDING.md §3, §6 «Что переиспользовано из платформы»): узнаваемость бренда
 * переносится, изоляция — нет. Логотип поэтому собран здесь заново и по здешней типографике
 * — дисплейная гарнитура и трекинг, как в шапке сайта, а не как в приложении.
 *
 * Серверный компонент и чистый CSS, без JS. Причина та же, по которой на CSS живёт первый
 * экран (LANDING.md §4.1): анимация обязана идти, пока бандл ещё грузится. Плюс два
 * следствия, важных именно для заставки: она попадает в первую отрисовку HTML — иначе
 * накрыла бы уже показанную страницу, — и уходит на `forwards`, то есть доходит до конца
 * даже там, где скрипты отключены, и не может запереть сайт под непрозрачным слоем.
 */
export function Splash() {
  return (
    // aria-hidden: содержания для скринридера здесь нет, а перехватывать фокус нечем.
    <div className="sh-splash fixed inset-0 z-[400] flex items-center justify-center" aria-hidden>
      <div className="sh-splash__mark flex items-center gap-3">
        <GraduationCap className="sh-splash__icon size-10 shrink-0 sm:size-12" aria-hidden />
        <span className="font-display text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
          StudentHub
        </span>
      </div>
    </div>
  )
}
