/**
 * Значение `Content-Disposition` для скачивания.
 *
 * Две формы имени обязательны: `filename` понимают все браузеры, но только ASCII —
 * кириллица в нём превратилась бы в мусор; `filename*` (RFC 5987) несёт настоящее имя
 * в UTF-8. Кавычки и обратный слэш в ASCII-варианте экранируются, иначе имя файла
 * могло бы закрыть строку и подставить свои параметры в заголовок.
 *
 * Жило внутри `files/file.service.ts` и было доступно только presign'у MinIO, поэтому
 * контроллеры, отдающие сгенерированные файлы, собирали заголовок руками и теряли
 * `filename*`. Одно место на весь проект — чтобы правило RFC 5987 соблюдалось само.
 */
export function attachmentHeader(name: string | null): string {
  const safe = name?.trim() || 'file'
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`
}
