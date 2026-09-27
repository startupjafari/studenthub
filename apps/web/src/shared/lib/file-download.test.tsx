import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { saveBlob, useFileDownload } from './file-download'

// Скачивание в приложение: нажатие → прогресс → готово → сохранить. Здесь фиксируется то,
// что человек видит на значке файла, и что сохранение не уходит мимо устройства: на
// компьютере — ссылкой на blob, на телефоне — листом «Поделиться».

/** Ответ fetch, отдающий тело частями — как поток из хранилища. */
function streamResponse(chunks: Uint8Array[], length?: number) {
  let i = 0
  return {
    ok: true,
    status: 200,
    headers: new Headers(length ? { 'content-length': String(length) } : {}),
    body: {
      getReader: () => ({
        read: () =>
          Promise.resolve(
            i < chunks.length
              ? { done: false, value: chunks[i++] }
              : { done: true, value: undefined },
          ),
      }),
    },
  }
}

let seq = 0
const freshKey = (): string => `test:${++seq}`

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useFileDownload', () => {
  it('скачивает файл до «готово» с его размером', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      streamResponse([new Uint8Array(3), new Uint8Array(2)], 5) as unknown as Response,
    )
    const key = freshKey()
    const { result } = renderHook(() =>
      useFileDownload(key, { url: 'https://s3/x?sig=1', name: 'a.zip' }),
    )

    expect(result.current.state.status).toBe('idle')
    act(() => result.current.toggle())
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    expect(result.current.state).toEqual({ status: 'ready', size: 5 })
  })

  it('ссылку, выдаваемую по запросу, берёт в момент нажатия', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(streamResponse([new Uint8Array(1)], 1) as unknown as Response)
    const url = vi.fn().mockResolvedValue('https://s3/y?sig=2')
    const key = freshKey()
    const { result } = renderHook(() => useFileDownload(key, { url, name: 'b.pdf' }))

    expect(url).not.toHaveBeenCalled()
    act(() => result.current.start())
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    expect(fetchSpy).toHaveBeenCalledWith('https://s3/y?sig=2', expect.anything())
  })

  it('отказ хранилища — «ошибка», и повторное нажатие начинает заново', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers(),
      body: null,
    } as unknown as Response)
    const key = freshKey()
    const { result } = renderHook(() =>
      useFileDownload(key, { url: 'https://s3/z', name: 'c.txt' }),
    )

    act(() => result.current.toggle())
    await waitFor(() => expect(result.current.state.status).toBe('error'))
  })

  it('отмена возвращает к исходному состоянию, а не к ошибке', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          )
        }),
    )
    const key = freshKey()
    const { result } = renderHook(() =>
      useFileDownload(key, { url: 'https://s3/w', name: 'd.zip' }),
    )

    act(() => result.current.toggle())
    await waitFor(() => expect(result.current.state.status).toBe('loading'))
    act(() => result.current.toggle())
    await waitFor(() => expect(result.current.state.status).toBe('idle'))
  })
})

describe('saveBlob', () => {
  it('на компьютере сохраняет скачиванием по ссылке на blob с именем файла', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList)
    URL.createObjectURL = vi.fn(() => 'blob:1')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await saveBlob(new Blob(['x']), 'report.pdf')

    expect(click).toHaveBeenCalledTimes(1)
    const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement
    expect(anchor.download).toBe('report.pdf')
  })

  it('на телефоне отдаёт файл листу «Поделиться», закрытый лист — не ошибка и не скачивание', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    const share = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' }))
    Object.assign(navigator, { canShare: () => true, share })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await saveBlob(new Blob(['x'], { type: 'application/zip' }), 'a.zip')

    expect(share).toHaveBeenCalledTimes(1)
    expect(click).not.toHaveBeenCalled()
  })
})
