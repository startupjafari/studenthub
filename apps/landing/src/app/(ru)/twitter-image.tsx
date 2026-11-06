// Тот же кадр, что для Open Graph. Отдельный файл нужен ради тега twitter:image: карточка
// summary_large_image объявлена в config/metadata.ts без картинки, а из openGraph Next
// её в twitter не переносит.
export { default, alt, size, contentType } from './opengraph-image'
