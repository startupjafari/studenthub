/**
 * Заглушка на время загрузки — на весь оставшийся экран.
 *
 * Раньше каждый экран рисовал свою: сводка — одну карточку, очередь жалоб — четыре строки,
 * поддержка — три, а «Люди» вообще ничего. Получалось, что при переходе между разделами
 * заглушка каждый раз другой высоты, и экран дёргался ещё до того, как приедут данные, —
 * а на «Людях» просто моргала пустота, неотличимая от «никого не нашлось».
 *
 * Отсюда правило: заглушка занимает ВСЁ, что осталось от экрана, и выглядит одинаково
 * везде. Строк намеренно с запасом — больше, чем влезает в самый высокий телефон; лишние
 * обрезает сам контейнер, потому что у списка уже есть `overflow: hidden` ради скруглений.
 * Так не нужно мерить высоту окна и перерисовываться на поворот экрана.
 *
 * `aria-hidden` обязателен: читалке нечего зачитывать в пустых прямоугольниках, а о том,
 * что идёт загрузка, ей сообщает `aria-busy` на экране.
 */

/** С запасом на самый высокий экран: лишнее обрежет контейнер. */
const ROWS = 12
const CARDS = 4

export function SkeletonList() {
  return (
    <section className="list skeleton-fill" aria-hidden="true">
      {Array.from({ length: ROWS }, (_, index) => (
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

/**
 * Вариант для экранов-карточек (открытая жалоба, сводка): там содержимое не список
 * одинаковых строк, и лента строк вместо карточек обещала бы не то, что приедет.
 */
export function SkeletonCards() {
  return (
    <div className="skeleton-cards" aria-hidden="true">
      {Array.from({ length: CARDS }, (_, index) => (
        <section className="card" key={index}>
          <span className="skeleton skeleton-title" />
          <span className="skeleton skeleton-line" />
          {index % 2 === 0 && <span className="skeleton skeleton-line short" />}
        </section>
      ))}
    </div>
  )
}
