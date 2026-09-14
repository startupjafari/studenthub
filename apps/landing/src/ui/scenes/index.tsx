import type { Dictionary } from '../../content'
import type { SceneKey } from '../../content/types'
import { DeviceFrame, type TabId } from './device-frame'
import { NotificationScene } from './notification-scene'
import { ScheduleScene } from './schedule-scene'
import { RequestScene } from './request-scene'
import { RoomScene } from './room-scene'
import { StudentIdScene } from './student-id-scene'

const SCENES: Record<
  SceneKey,
  { Component: (props: { dict: Dictionary }) => React.ReactElement; tab: TabId }
> = {
  notification: { Component: NotificationScene, tab: 'home' },
  schedule: { Component: ScheduleScene, tab: 'schedule' },
  request: { Component: RequestScene, tab: 'requests' },
  // Помещение открывается по QR из любого места приложения — своей вкладки у него нет,
  // поэтому подсвечена домашняя, как и было бы на самом деле.
  room: { Component: RoomScene, tab: 'home' },
  studentId: { Component: StudentIdScene, tab: 'id' },
}

/**
 * Сцена дня в рамке телефона.
 *
 * Вызывающий обязан передать `key={scene}`: анимации внутри проигрываются один раз, и
 * без пересоздания узла переключение на новый кадр показало бы уже доигравшую сцену.
 */
export function Scene({
  scene,
  dict,
  time,
}: {
  scene: SceneKey
  dict: Dictionary
  /** Время момента — уходит в часы телефона, чтобы они не спорили со сценой. */
  time?: string
}) {
  const { Component, tab } = SCENES[scene]

  return (
    <DeviceFrame appName={dict.scenes.appName} activeTab={tab} time={time}>
      <Component dict={dict} />
    </DeviceFrame>
  )
}

export { DeviceFrame }
