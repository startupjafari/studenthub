import { FILE_UPLOAD } from '@studenthub/shared-config'
import type { UploadedPart } from './multipart-upload'

/**
 * Состояние незавершённой многочастной загрузки — чтобы продолжить её, а не начинать заново
 * (Фаза 19.4).
 *
 * Где живёт: IndexedDB. Не `localStorage` — тот синхронный, и на каждую залитую часть блокировал
 * бы поток ради записи; к тому же правила запрещают держать в нём данные сессии, а ключ объекта
 * в приватном бакете к ним близок.
 *
 * Границы честные: докачка переживает перезагрузку вкладки и обрыв сети. Смену устройства и
 * очистку данных сайта — нет, там загрузка начинается заново. Это свойство схемы, а не
 * недоделка: `ETag`'и частей хранит только клиент (в `minio@8` серверный `listParts`
 * объявлен protected), и взять их на новом устройстве неоткуда.
 */

export interface ResumeRecord {
  fingerprint: string
  bucket: string
  key: string
  uploadId: string
  partSize: number
  partCount: number
  parts: UploadedPart[]
  /** Момент открытия загрузки, мс. По нему запись протухает. */
  createdAt: number
}

/**
 * Срок жизни записи — сутки, ровно столько же, сколько живёт сама загрузка в хранилище
 * (`sweepIncompleteUploads` отменяет брошенные старше суток). Дольше держать смысла нет:
 * продолжать было бы нечего, а предложение «продолжить» вело бы в ошибку.
 */
const RESUME_TTL_MS = 24 * 60 * 60 * 1000

const DB_NAME = 'studenthub-uploads'
const DB_VERSION = 1
const STORE = 'resume'

/** Подпись файла: другого способа узнать «тот же самый файл» у браузера нет. */
export function fingerprintOf(file: File, bucket: string): string {
  return `${bucket}|${file.name}|${file.size}|${file.lastModified}`
}

export interface ResumeStore {
  load: (fingerprint: string) => Promise<ResumeRecord | null>
  save: (record: ResumeRecord) => Promise<void>
  drop: (fingerprint: string) => Promise<void>
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'fingerprint' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * Хранилище поверх IndexedDB. Любая ошибка проглатывается: докачка — удобство, и загрузка
 * не должна падать из-за того, что браузер запретил хранение (приватный режим, отключённые
 * данные сайтов) или база не открылась.
 */
export const indexedDbResumeStore: ResumeStore = {
  async load(fingerprint) {
    if (typeof indexedDB === 'undefined') return null
    try {
      const db = await openDb()
      const tx = db.transaction(STORE, 'readonly')
      const record = await promisify<ResumeRecord | undefined>(
        tx.objectStore(STORE).get(fingerprint) as IDBRequest<ResumeRecord | undefined>,
      )
      db.close()
      if (!record) return null
      // Протухшую запись не возвращаем и подчищаем: предложить продолжить то, что хранилище
      // уже отменило, хуже, чем начать заново.
      if (Date.now() - record.createdAt > RESUME_TTL_MS) {
        await indexedDbResumeStore.drop(fingerprint)
        return null
      }
      return record
    } catch {
      return null
    }
  },

  async save(record) {
    if (typeof indexedDB === 'undefined') return
    try {
      const db = await openDb()
      const tx = db.transaction(STORE, 'readwrite')
      await promisify(tx.objectStore(STORE).put(record) as IDBRequest)
      db.close()
    } catch {
      // Не смогли запомнить — просто не будет докачки.
    }
  },

  async drop(fingerprint) {
    if (typeof indexedDB === 'undefined') return
    try {
      const db = await openDb()
      const tx = db.transaction(STORE, 'readwrite')
      await promisify(tx.objectStore(STORE).delete(fingerprint) as IDBRequest)
      db.close()
    } catch {
      // Мусор переживёт сутки и уйдёт по TTL.
    }
  },
}

/**
 * Годится ли сохранённое состояние для этого файла.
 *
 * Сверяется с ТЕКУЩЕЙ нарезкой, а не с самой записью: размер части приходит из общих констант
 * и мог измениться между запусками (правка настроек, другой выпуск приложения). Продолжать по
 * старой нарезке нельзя — части не сойдутся, и развалится именно сборка, то есть после того,
 * как всё уже перезалито.
 *
 * Номера частей тоже проверяются: запись из будущей версии с другим числом частей должна быть
 * отброшена, а не «продолжена» наполовину.
 */
export function isResumable(record: ResumeRecord, file: File): boolean {
  const partSize = FILE_UPLOAD.MULTIPART_PART_BYTES
  if (record.partSize !== partSize) return false
  if (record.partCount !== Math.ceil(file.size / partSize)) return false
  return record.parts.every((p) => p.part >= 1 && p.part <= record.partCount)
}
