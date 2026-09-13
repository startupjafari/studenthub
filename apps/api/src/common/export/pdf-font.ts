import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Кириллический шрифт для PDF: один на все документы платформы.
 *
 * Четырнадцать стандартных шрифтов PDF кириллицы не содержат — без встроенного файла
 * документ на русском выйдет пустым. Файл лежит в репозитории (assets/fonts/README.md) и
 * покрывает казахские буквы (Ә Ғ Қ Ң Ө Ұ Ү Һ І), поэтому годится и для kk-документов.
 *
 * Жило в career/resume-pdf.ts. Переехало сюда, когда генераторов PDF стало два: разойтись
 * шрифтом у резюме и справки — значит получить два разных документа одной платформы.
 */
export const PDF_FONT_FAMILY = 'Inter'

/**
 * Путь к файлу шрифта.
 *
 * Считаем от каталога модуля, а не от `process.cwd()`: рабочий каталог зависит от того,
 * откуда запустили процесс, и в монорепо это то корень репозитория, то пакет. От
 * `__dirname` три уровня вверх дают корень пакета api и в `src/`, и в собранном `dist/`.
 */
export function pdfFontPath(): string {
  const candidates = [
    join(__dirname, '..', '..', '..', 'assets', 'fonts', 'InterVariable.ttf'),
    join(process.cwd(), 'assets', 'fonts', 'InterVariable.ttf'),
    join(process.cwd(), 'apps', 'api', 'assets', 'fonts', 'InterVariable.ttf'),
  ]
  const found = candidates.find((path) => existsSync(path))
  if (!found) {
    // Падаем внятно: без шрифта PDF на русском выйдет пустым, и молчаливая деградация
    // здесь хуже ошибки. С логотипом решение обратное — документ без картинки годен.
    throw new Error(`Шрифт для PDF не найден. Искали: ${candidates.join(', ')}`)
  }
  return found
}

/**
 * Регистрация шрифта в реестре @react-pdf. Реестр глобальный на процесс, повторный вызов
 * безвреден — каждый генератор зовёт её в своей ленивой загрузке.
 */
export function registerPdfFont(font: {
  register: (options: { family: string; src: string }) => void
  registerHyphenationCallback: (callback: (word: string) => string[]) => void
}): void {
  font.register({ family: PDF_FONT_FAMILY, src: pdfFontPath() })
  // Переносы слов отключаем: встроенный словарь переносов рассчитан на английский и
  // рвёт русские слова в неожиданных местах.
  font.registerHyphenationCallback((word) => [word])
}
