// Мозаика альбома, как в Telegram: раскладка подбирается по пропорциям самих снимков, а не
// одной сеткой квадратов. Широкий первый кадр ложится полосой сверху, узкий — колонкой слева,
// остальные — рядами одинаковой высоты, где каждый кадр сохраняет свою пропорцию.
//
// Считаем в условных пикселях ширины `width`, а отдаём доли (0..1) — альбом тянется под любую
// ширину пузыря, сохраняя пропорцию всего блока (`aspect`).

export type AlbumTile = { x: number; y: number; w: number; h: number }
export type AlbumLayout = { tiles: AlbumTile[]; aspect: number }

type Rect = AlbumTile

const WIDE = 1.2
const NARROW = 0.8

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** Ряд кадров одной высоты во всю ширину: ширина каждого — по его пропорции. */
function row(ratios: number[], y: number, width: number, gap: number): Rect[] {
  const sum = ratios.reduce((a, r) => a + r, 0)
  const free = width - gap * (ratios.length - 1)
  const h = free / sum
  let x = 0
  return ratios.map((r, i) => {
    // Последний кадр добирает остаток — без щели из-за округления.
    const w = i === ratios.length - 1 ? width - x : (free * r) / sum
    const rect = { x, y, w, h }
    x += w + gap
    return rect
  })
}

/** Колонка кадров одной ширины: высота каждого — по его пропорции, сумма — `height`. */
function column(ratios: number[], x: number, w: number, height: number, gap: number): Rect[] {
  const inv = ratios.map((r) => 1 / r)
  const sum = inv.reduce((a, v) => a + v, 0)
  const free = height - gap * (ratios.length - 1)
  let y = 0
  return inv.map((v, i) => {
    const h = i === inv.length - 1 ? height - y : (free * v) / sum
    const rect = { x, y, w, h }
    y += h + gap
    return rect
  })
}

/** Узкий кадр колонкой слева во всю высоту, остальные — столбиком справа. */
function leftColumn(r: number[], width: number, gap: number): Rect[] {
  const [first, ...rest] = r
  const lead = first ?? 1
  const invSum = rest.reduce((a, v) => a + 1 / v, 0)
  // Ширина правой колонки, при которой обе колонки равны по высоте, — с потолками, чтобы ни
  // одна не схлопнулась в полоску.
  const right = clamp(
    (width - gap - lead * gap * (rest.length - 1)) / (1 + lead * invSum),
    width * 0.33,
    width * 0.6,
  )
  const left = width - gap - right
  const height = clamp(left / lead, width * 0.6, width * 1.25)
  return [{ x: 0, y: 0, w: left, h: height }, ...column(rest, left + gap, right, height, gap)]
}

/** Широкий кадр полосой сверху, остальные — одним рядом под ним. */
function topBand(r: number[], width: number, gap: number): Rect[] {
  const [first, ...rest] = r
  const top = clamp(width / (first ?? 1), width * 0.4, width * 0.75)
  return [{ x: 0, y: 0, w: width, h: top }, ...row(rest, top + gap, width, gap)]
}

/**
 * Ряды по 2–4 кадра: выбираем разбиение, у которого высота рядов ближе всего к трети ширины
 * (так в Telegram выглядит длинный альбом), без одиночных кадров в ряду.
 */
function rows(r: number[], width: number, gap: number): Rect[] {
  const n = r.length
  const target = width / 3
  const cost: number[] = Array.from({ length: n + 1 }, () => Infinity)
  const cut: number[] = Array.from({ length: n + 1 }, () => 0)
  cost[0] = 0
  for (let end = 2; end <= n; end++) {
    for (let k = 2; k <= 4 && k <= end; k++) {
      const start = end - k
      const prev = cost[start] ?? Infinity
      if (prev === Infinity) continue
      const sum = r.slice(start, end).reduce((a, v) => a + v, 0)
      const h = (width - gap * (k - 1)) / sum
      const c = prev + (h - target) ** 2
      if (c < (cost[end] ?? Infinity)) {
        cost[end] = c
        cut[end] = start
      }
    }
  }
  const bounds: [number, number][] = []
  for (let end = n; end > 0; end = cut[end] ?? 0) bounds.unshift([cut[end] ?? 0, end])
  const out: Rect[] = []
  let y = 0
  for (const [start, end] of bounds) {
    const line = row(r.slice(start, end), y, width, gap)
    out.push(...line)
    y += (line[0]?.h ?? 0) + gap
  }
  return out
}

/**
 * Раскладка альбома по пропорциям кадров (ширина / высота; неизвестная — квадрат).
 * `gap` — зазор между кадрами в тех же условных пикселях, что и `width`.
 */
export function albumLayout(ratiosIn: number[], width = 320, gap = 2): AlbumLayout {
  const r = ratiosIn.map((v) => (Number.isFinite(v) && v > 0 ? clamp(v, 0.5, 3) : 1))
  const n = r.length
  const first = r[0] ?? 1
  const avg = r.reduce((a, v) => a + v, 0) / Math.max(1, n)
  let rects: Rect[]
  if (n <= 1) {
    rects = [{ x: 0, y: 0, w: width, h: width / first }]
  } else if (n === 2) {
    // Два широких — друг под другом, иначе рядом одной высоты.
    rects =
      r.every((v) => v > WIDE) && avg > 1.4
        ? column(
            r,
            0,
            width,
            r.reduce((a, v) => a + width / v, gap),
            gap,
          )
        : row(r, 0, width, gap)
  } else if (n <= 4 && first > WIDE) {
    rects = topBand(r, width, gap)
  } else if (n <= 4 && first < NARROW) {
    rects = leftColumn(r, width, gap)
  } else if (n === 3) {
    rects = topBand(r, width, gap)
  } else if (n === 4) {
    const upper = row(r.slice(0, 2), 0, width, gap)
    rects = [...upper, ...row(r.slice(2), (upper[0]?.h ?? 0) + gap, width, gap)]
  } else {
    rects = rows(r, width, gap)
  }
  const height = rects.reduce((m, t) => Math.max(m, t.y + t.h), 0) || width
  return {
    aspect: width / height,
    tiles: rects.map((t) => ({
      x: t.x / width,
      y: t.y / height,
      w: t.w / width,
      h: t.h / height,
    })),
  }
}
