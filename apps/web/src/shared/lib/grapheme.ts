let segmenter: Intl.Segmenter | null | undefined

function graphemeSegmenter(): Intl.Segmenter | null {
  if (segmenter === undefined) {
    segmenter =
      typeof Intl !== 'undefined' && 'Segmenter' in Intl
        ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
        : null
  }
  return segmenter
}

/**
 * Длина (в UTF-16, как считают позиции редактора) последней графемы строки — того, что
 * человек видит одним знаком. Кнопка «стереть» в панели эмодзи убирает её целиком: 👨‍👩‍👧 —
 * это пять кодовых точек и восемь единиц UTF-16, и посимвольное стирание оставляло бы от
 * семьи обломки, а от флага — одну «региональную букву».
 *
 * Без `Intl.Segmenter` (очень старые браузеры) — последняя кодовая точка: суррогатную пару
 * пополам всё равно не разрежем.
 */
export function lastGraphemeLength(text: string): number {
  if (!text) return 0
  const seg = graphemeSegmenter()
  if (seg) {
    // Хвоста хватает: длиннее 64 единиц графем не бывает даже у флагов регионов.
    const tail = text.slice(-64)
    let last = ''
    for (const { segment } of seg.segment(tail)) last = segment
    return last.length
  }
  const chars = Array.from(text)
  return chars[chars.length - 1]?.length ?? 0
}
