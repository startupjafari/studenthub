import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'
import type { Locale } from '../config/site'
import { getDictionary } from '../content'
import { woff2ToTtf } from './woff2'

/**
 * Картинка превью ссылки (Open Graph и Twitter) — одна на язык.
 *
 * Без неё ссылка на сайт в Telegram и WhatsApp приезжала голым заголовком, а у сайта,
 * который продают вузу пересылкой из рук в руки, превью и есть первый экран.
 *
 * Генератор общий, а файлы `opengraph-image.tsx` лежат в сегменте каждого языка: файловая
 * конвенция Next сама кладёт адрес картинки в метаданные именно этой языковой версии, и
 * казахская ссылка показывает казахское превью.
 */

/** Размер, который Telegram, WhatsApp, Facebook и X показывают без обрезки. */
export const OG_SIZE = { width: 1200, height: 630 }
export const OG_CONTENT_TYPE = 'image/png'

/** Подпись картинки для скринридеров — тот же заголовок, что у страницы. */
export function ogAlt(locale: Locale): string {
  return getDictionary(locale).meta.title
}

/*
  Цвета — тёмная тема лендинга (src/app/globals.css, @media prefers-color-scheme: dark),
  пересчитанные из oklch в hex: satori, который рисует картинку, oklch не понимает.
  Тёмная, а не светлая: лендинг задуман тёмным, и превью должно выглядеть как сайт, на
  который ведёт.
*/
const COLORS = {
  background: '#04070e', // --background  oklch(0.129 0.018 264.5)
  foreground: '#e7eaef', // --foreground  oklch(0.936 0.008 264.5)
  primary: '#2b72e5', // --primary       oklch(0.573 0.188 259.8)
  primaryDeep: '#2563eb', // --primary светлой темы и themeColor — заливка значка
  violet: '#6c38d2', // оттенок из градиента .sh-cta: oklch(0.5 0.22 292)
  muted: '#9aa3b2', // --muted-foreground, поднятый на ступень: превью смотрят уменьшенным
  // Полупрозрачные — через rgba, а не восьмизначный hex: разбор цвета в градиентах у satori
  // свой, и rgba в нём — самая проверенная запись.
  glow: 'rgba(43, 114, 229, 0.5)', // --glow, усиленный: на превью нет курсора-подсветки
  dots: 'rgba(231, 234, 239, 0.22)', // точки сетки — --foreground с прозрачностью
}

/**
 * Шрифт — Onest, дисплейная гарнитура лендинга, из уже установленного пакета.
 *
 * В пакете только woff2, а satori его не читает, поэтому файлы распаковываются в ttf
 * на лету (подробно — в ./woff2.ts). Наборы fontsource разбиты по алфавитам, и нужны три:
 * латиница, кириллица и расширенная кириллица — в последней казахские ә, ғ, қ, ң, ө, ү, һ
 * (ұ и і лежат в основной).
 *
 * У каждого набора своё имя семейства, и это не косметика. Из нескольких шрифтов с одним
 * именем satori выбирает ОДИН — по весу и стилю — и в остальных глиф не ищет; запасными он
 * перебирает только другие семейства. С общим именем «Onest» кириллица пропадала. Хуже
 * того, пропажу не видно, если на сборке есть сеть: за недостающими глифами `next/og` сам
 * ходит в Google Fonts и молча подставляет Noto Sans.
 *
 * Путь от process.cwd(), а не через require.resolve: сборщик Next подменяет
 * require.resolve номером модуля. Читается файл только на `next build` — картинка
 * статическая и в рантайме не перерисовывается.
 *
 * Начертание одно — 400. Пакет вариативный, а satori не применяет оси вариаций и рисует
 * начертание по умолчанию; жирность заголовку добавляет обводка, см. OgImage.
 */
const FONT_SUBSETS = ['latin', 'cyrillic', 'cyrillic-ext'] as const
const FONT_FAMILY = FONT_SUBSETS.map((subset) => `Onest ${subset}`).join(', ')

async function loadFonts() {
  const dir = join(process.cwd(), 'node_modules/@fontsource-variable/onest/files')
  return Promise.all(
    FONT_SUBSETS.map(async (subset) => ({
      name: `Onest ${subset}`,
      data: woff2ToTtf(await readFile(join(dir, `onest-${subset}-wght-normal.woff2`))),
      weight: 400 as const,
      style: 'normal' as const,
    })),
  )
}

/**
 * Заголовок превью — `meta.title` без бренда: «StudentHub — университет целиком в одном
 * приложении» превращается в «Университет целиком в одном приложении». Бренд и так стоит
 * над заголовком знаком и словом, а повтор съел бы строку крупного кегля.
 */
function headline(title: string): string {
  const text = title.replace(/^StudentHub\s*[—–-]\s*/, '')
  return text.charAt(0).toLocaleUpperCase() + text.slice(1)
}

export async function renderOgImage(locale: Locale): Promise<ImageResponse> {
  const dict = getDictionary(locale)
  return new ImageResponse(
    <OgImage title={headline(dict.meta.title)} subtitle={dict.footer.tagline} />,
    { ...OG_SIZE, fonts: await loadFonts() },
  )
}

/**
 * Разметка картинки. Стили — инлайном: satori понимает подмножество CSS через style и не
 * знает ни Tailwind, ни классов, ни переменных.
 */
function OgImage({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        width: '100%',
        height: '100%',
        padding: '72px 80px 84px',
        background: COLORS.background,
        color: COLORS.foreground,
        fontFamily: FONT_FAMILY,
      }}
    >
      {/* Подсветка и точечная сетка — тот же приём, что у первого экрана (.mesh-base).
          Размер — числом, а не `inset: 0` или 100%: inset satori не знает, а проценты у
          абсолютного слоя он считает от области без отступов родителя. */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: OG_SIZE.width,
          height: OG_SIZE.height,
          display: 'flex',
          // Центр по вертикали — 1px, а не 0: нулевую координату satori теряет и ставит
          // центр посередине высоты.
          backgroundImage: `radial-gradient(circle at 1000px 1px, ${COLORS.glow} 0%, transparent 720px)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: OG_SIZE.width,
          height: OG_SIZE.height,
          display: 'flex',
          // Точка радиусом ~1,5px в клетке 24px: 9% от луча градиента (до угла клетки, 17px).
          backgroundImage: `radial-gradient(circle at 12px 12px, ${COLORS.dots} 9%, transparent 0%)`,
          backgroundSize: '24px 24px',
          // Сетка гаснет к левому нижнему углу — там текст, и точки под буквами рябят.
          maskImage: 'linear-gradient(225deg, black 0%, transparent 75%)',
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <BrandMark />
        <span style={{ fontSize: 40, letterSpacing: '-0.02em' }}>StudentHub</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        {/*
          Обводка цветом самой буквы — синтетическая жирность: вариативный шрифт satori
          рисует только в начертании 400, а заголовок на сайте полужирный. Межбуквенный
          интервал чуть шире, чем на сайте, — обводка утолщает буквы и наружу.
        */}
        <span
          style={{
            maxWidth: 1000,
            fontSize: 76,
            lineHeight: 1.08,
            letterSpacing: '-0.025em',
            // Иначе предлог «в» остаётся висеть в конце первой строки.
            textWrap: 'balance',
            WebkitTextStroke: `2px ${COLORS.foreground}`,
          }}
        >
          {title}
        </span>
        <span style={{ maxWidth: 900, fontSize: 32, lineHeight: 1.4, color: COLORS.muted }}>
          {subtitle}
        </span>
      </div>

      {/* Брендовая полоса снизу — градиент карточки призыва (.sh-cta). */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 12,
          display: 'flex',
          backgroundImage: `linear-gradient(90deg, ${COLORS.primaryDeep}, ${COLORS.primary} 46%, ${COLORS.violet})`,
        }}
      />
    </div>
  )
}

/**
 * Знак — шапочка из подвала (`GraduationCap` из lucide) на синей плашке. lucide-react
 * в satori не отрисуется — это клиентский компонент с контекстом, — поэтому контуры
 * иконки перенесены сюда как есть (lucide 1.x, viewBox 24×24, обводка 2).
 */
function BrandMark() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 72,
        height: 72,
        borderRadius: 18,
        backgroundImage: `linear-gradient(135deg, ${COLORS.primaryDeep}, ${COLORS.primary} 46%, ${COLORS.violet})`,
      }}
    >
      <svg
        width="44"
        height="44"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z" />
        <path d="M22 10v6" />
        <path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5" />
      </svg>
    </div>
  )
}
