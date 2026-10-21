import type Hls from 'hls.js'

// Живой поток камеры с ретранслятора (docs/PROJECT.md §3.10): LL-HLS через hls.js, токен
// в заголовке `Authorization: Bearer`. Токен меняется каждые 30 с — берём его на каждый
// запрос через `getToken`, а не фиксируем при запуске.
//
// Первые секунды плейлиста может не быть: агент только поднимает поток. Поэтому манифест
// повторяем терпеливо, а не сдаёмся на первом 404.

export type LiveState = 'connecting' | 'playing' | 'unsupported' | 'failed'

export interface LiveHandle {
  destroy: () => void
}

function hasMediaSource(): boolean {
  return (
    typeof window !== 'undefined' && ('MediaSource' in window || 'ManagedMediaSource' in window)
  )
}

export async function attachLive(
  video: HTMLVideoElement,
  url: string,
  getToken: () => string,
  onState: (state: LiveState) => void,
): Promise<LiveHandle> {
  // Нативный HLS (старый Safari) не умеет слать заголовок с токеном, а без токена
  // ретранслятор видео не отдаст. Честнее сказать «браузер не подходит», чем крутить
  // бесконечную загрузку.
  if (!hasMediaSource()) {
    onState('unsupported')
    return { destroy: () => undefined }
  }
  const { default: HlsCtor } = await import('hls.js')
  if (!HlsCtor.isSupported()) {
    onState('unsupported')
    return { destroy: () => undefined }
  }
  const retry = {
    maxNumRetry: 30,
    retryDelayMs: 1_000,
    maxRetryDelayMs: 4_000,
  }
  const hls: Hls = new HlsCtor({
    lowLatencyMode: true,
    // Держимся у края эфира: охране нужен «сейчас», а не запас в буфере.
    liveSyncDurationCount: 2,
    maxBufferLength: 6,
    backBufferLength: 0,
    xhrSetup: (xhr) => {
      xhr.setRequestHeader('Authorization', `Bearer ${getToken()}`)
    },
    manifestLoadPolicy: {
      default: {
        maxTimeToFirstByteMs: 10_000,
        maxLoadTimeMs: 20_000,
        timeoutRetry: retry,
        errorRetry: retry,
      },
    },
  })
  let recovered = false
  hls.on(HlsCtor.Events.FRAG_BUFFERED, () => onState('playing'))
  hls.on(HlsCtor.Events.ERROR, (_e, data) => {
    if (!data.fatal) return
    if (!recovered && data.type === HlsCtor.ErrorTypes.MEDIA_ERROR) {
      recovered = true
      hls.recoverMediaError()
      return
    }
    onState('failed')
  })
  onState('connecting')
  hls.loadSource(url)
  hls.attachMedia(video)
  void video.play().catch(() => undefined)
  return { destroy: () => hls.destroy() }
}
