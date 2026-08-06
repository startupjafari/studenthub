// DI-токен MinIO-клиента вынесен отдельно, чтобы модуль и сервисы могли
// импортировать его без циклической зависимости между minio.module и сервисами.
export const MINIO_CLIENT = Symbol('MINIO_CLIENT')

// Клиент для генерации presigned-ссылок, отдаваемых В БРАУЗЕР: endpoint должен быть
// публичным (browser не резолвит приватный minio.railway.internal). Хост входит в
// подпись S3, поэтому ссылку нельзя «переписать» после — её генерят сразу на публичный
// адрес. Если MINIO_PUBLIC_ENDPOINT не задан (dev) — совпадает с MINIO_CLIENT.
export const MINIO_PUBLIC_CLIENT = Symbol('MINIO_PUBLIC_CLIENT')
