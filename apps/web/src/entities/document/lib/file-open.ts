/** Файлы, которые умеет показать общий просмотрщик (MediaViewer): картинки и видео. */
export function isViewableMedia(mime: string): boolean {
  return mime.startsWith('image/') || mime.startsWith('video/')
}

/**
 * Начать скачивание по presigned-ссылке со схемой `attachment`.
 *
 * Атрибут `download` здесь бесполезен — объект на другом origin, браузер его игнорирует.
 * Работает именно заголовок в подписанной ссылке: навигации не происходит, страница
 * остаётся на месте, файл уходит в загрузки.
 */
export function saveFileByUrl(url: string): void {
  const a = document.createElement('a')
  a.href = url
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
}
