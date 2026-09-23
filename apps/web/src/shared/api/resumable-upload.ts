import { uploadMultipart, type MultipartTarget, type UploadedPart } from './multipart-upload'
import {
  fingerprintOf,
  indexedDbResumeStore,
  isResumable,
  type ResumeRecord,
  type ResumeStore,
} from './upload-resume'

/**
 * Многочастная загрузка, которая переживает обрыв (Фаза 19.4).
 *
 * Поверх `uploadMultipart` добавляется ровно одно: состояние загрузки запоминается по мере
 * заливки частей и подхватывается, если тот же файл выбрали снова. Сам `uploadMultipart`
 * остаётся без знания о хранилище — он и так умеет принимать уже готовую загрузку и список
 * залитых частей.
 */

/** Ошибка, после которой продолжать нечего: загрузки в хранилище больше нет. */
function isUploadGone(error: unknown): boolean {
  const e = error as { code?: string; response?: { status?: number } }
  if (e?.response?.status === 404) return true
  // Интерцептор приложения разворачивает ответ в { code, message }.
  return e?.code === 'NOT_FOUND' || e?.code === 'BAD_REQUEST'
}

export async function uploadResumable<T>(params: {
  file: File
  /** Входит в отпечаток: один и тот же файл в разные бакеты — разные загрузки. */
  bucket: string
  start: (mime: string, size: number) => Promise<MultipartTarget>
  urls: (range: {
    key: string
    uploadId: string
    from: number
    to: number
  }) => Promise<{ part: number; url: string }[]>
  complete: (input: {
    key: string
    uploadId: string
    parts: UploadedPart[]
    name: string
  }) => Promise<T>
  abort?: (input: { key: string; uploadId: string }) => Promise<void>
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
  /** Подменяется в тестах; по умолчанию — IndexedDB. */
  store?: ResumeStore
}): Promise<T> {
  const store = params.store ?? indexedDbResumeStore
  const fingerprint = fingerprintOf(params.file, params.bucket)

  // Запись обновляется по мере заливки: каждая принятая часть сохраняется сразу, иначе обрыв
  // на сороковой части из пятидесяти не оставил бы от прогресса ничего.
  let record: ResumeRecord | null = null
  const remember = async (target: MultipartTarget, parts: UploadedPart[]): Promise<void> => {
    record = {
      fingerprint,
      bucket: params.bucket,
      key: target.key,
      uploadId: target.uploadId,
      partSize: target.partSize,
      partCount: target.partCount,
      parts,
      createdAt: record?.createdAt ?? Date.now(),
    }
    await store.save(record)
  }

  const run = async (resume?: { target: MultipartTarget; done: UploadedPart[] }): Promise<T> => {
    const done = [...(resume?.done ?? [])]
    let target = resume?.target
    const result = await uploadMultipart<T>({
      file: params.file,
      start: params.start,
      urls: params.urls,
      complete: params.complete,
      abort: params.abort,
      onProgress: params.onProgress,
      signal: params.signal,
      resume: target,
      done,
      onStart: (t) => {
        target = t
        void remember(t, done)
      },
      onPartDone: (part) => {
        done.push(part)
        if (target) void remember(target, done)
      },
    })
    // Дошли до конца — состояние больше не нужно, а лежать оно будет сутки.
    await store.drop(fingerprint)
    return result
  }

  const saved = await store.load(fingerprint)
  if (saved) {
    const target: MultipartTarget = {
      key: saved.key,
      uploadId: saved.uploadId,
      partSize: saved.partSize,
      partCount: saved.partCount,
    }
    // Сверяем нарезку с текущей: размер части приходит из общих констант и между запусками
    // мог измениться. По старой нарезке части не сойдутся, и развалится именно сборка —
    // после того, как всё уже перезалито.
    if (isResumable(saved, params.file)) {
      record = saved
      try {
        return await run({ target, done: saved.parts })
      } catch (e) {
        // Отмену не переигрываем: пользователь нажал крестик.
        if (params.signal?.aborted) throw e
        // Загрузки уже нет (её отменила ночная уборка или истёк срок) — начинаем заново.
        // В остальных случаях состояние сохраняем: следующая попытка продолжит с него.
        if (!isUploadGone(e)) throw e
        await store.drop(fingerprint)
        record = null
      }
    } else {
      await store.drop(fingerprint)
    }
  }

  return run()
}
