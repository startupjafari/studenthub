import { mapRailwayHook } from './railway.mapper'

// docs/TELEGRAM_BOT.md §7.5: маппер каждого источника — на зафиксированном примере payload.
// Payload ниже — форма вебхука Railway о развёртывании, урезанная до полей, которые читаем.

const payload = (status: string) => ({
  type: 'DEPLOY',
  status,
  project: { id: 'prj-1', name: 'studenthub' },
  environment: { id: 'env-1', name: 'production' },
  service: { id: 'svc-1', name: 'api' },
  deployment: {
    id: 'dep-42',
    creator: { name: 'startupjafari' },
    meta: { branch: 'main', commitHash: '2c7a86e1f9d0b4a5c6e7d8f9a0b1c2d3e4f5a6b7' },
  },
})

describe('mapRailwayHook', () => {
  it('начавшийся деплой — 🟡 с веткой, коротким SHA и автором', () => {
    expect(mapRailwayHook(payload('BUILDING'))).toEqual({
      event: 'deployStarted',
      data: {
        deploymentId: 'dep-42',
        service: 'api',
        branch: 'main',
        sha: '2c7a86e',
        author: 'startupjafari',
        fullSha: '2c7a86e1f9d0b4a5c6e7d8f9a0b1c2d3e4f5a6b7',
        logsUrl: 'https://railway.app/project/prj-1/service/svc-1?environmentId=env-1&id=dep-42',
      },
    })
  })

  it('все промежуточные статусы дают одно и то же 🟡 — строка в канале одна', () => {
    for (const status of ['QUEUED', 'INITIALIZING', 'DEPLOYING', 'WAITING']) {
      expect(mapRailwayHook(payload(status))?.event).toBe('deployStarted')
    }
  })

  it('успех и падение — отдельные события с тем же deploymentId', () => {
    expect(mapRailwayHook(payload('SUCCESS'))?.event).toBe('deploySucceeded')
    expect(mapRailwayHook(payload('FAILED'))?.event).toBe('deployFailed')
    expect(mapRailwayHook(payload('CRASHED'))?.event).toBe('deployFailed')
    // Один и тот же ключ правки — иначе на релиз в канале будет три строки вместо одной.
    expect(mapRailwayHook(payload('SUCCESS'))?.data.deploymentId).toBe('dep-42')
  })

  it('не относящиеся к релизу статусы игнорируются молча', () => {
    expect(mapRailwayHook(payload('REMOVED'))).toBeNull()
    expect(mapRailwayHook(payload('SLEEPING'))).toBeNull()
  })

  it('ручной деплой без коммита проходит — просто без ветки и SHA', () => {
    const manual = mapRailwayHook({
      status: 'SUCCESS',
      service: { name: 'web' },
      deployment: { id: 'dep-7' },
    })

    expect(manual).toEqual({
      event: 'deploySucceeded',
      data: { deploymentId: 'dep-7', service: 'web' },
    })
  })

  it('мусор вместо payload не роняет приём вебхука', () => {
    expect(mapRailwayHook({})).toBeNull()
    expect(mapRailwayHook({ status: 'SUCCESS' })).toBeNull()
    expect(mapRailwayHook({ status: 123, deployment: 'нет' })).toBeNull()
  })
})
