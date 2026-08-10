import { LinkPreviewService } from './link-preview.service'

// SSRF-гарды выборки превью: без сети — проверяем отказ по протоколу и приватным IP-литералам
// (для таких хостов сервис не должен делать исходящий запрос вообще).
describe('LinkPreviewService — SSRF-гарды', () => {
  const service = new LinkPreviewService()
  const fetchSpy = jest.spyOn(globalThis, 'fetch')

  afterEach(() => fetchSpy.mockReset())
  afterAll(() => fetchSpy.mockRestore())

  it('не-http(s) протокол → null, без запроса', async () => {
    expect(await service.fetch('ftp://example.com/file')).toBeNull()
    expect(await service.fetch('javascript:alert(1)')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('loopback IP → null, без запроса', async () => {
    expect(await service.fetch('http://127.0.0.1/admin')).toBeNull()
    expect(await service.fetch('http://[::1]/')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('приватные диапазоны (10/172.16-31/192.168/169.254) → null, без запроса', async () => {
    for (const ip of ['10.0.0.5', '172.16.0.1', '192.168.1.1', '169.254.169.254']) {
      expect(await service.fetch(`http://${ip}/`)).toBeNull()
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('битый URL → null', async () => {
    expect(await service.fetch('not a url')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
