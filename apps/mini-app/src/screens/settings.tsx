import { useState } from 'react'
import { haptic } from '../telegram/webapp'
import { useBackButton } from '../telegram/use-telegram'
import { applyFontScale, isLargeFont } from '../lib/font-scale'
import { ScreenHeader } from '../ui/screen-header'
import { Tile } from '../ui/tile'
import { IconTextSize } from '../ui/icons'
import { t } from '../i18n'

// Настройки — пункт «Настройки» в меню «⋯» Telegram (SettingsButton).
//
// Здесь только настройки устройства: размер текста и то, откуда берутся язык и тема.
// Раньше размер текста жил в «Управлении» — вкладке администратора, — и модератору,
// которому крупный шрифт нужен не меньше, до него было не добраться. Меню «⋯» есть
// у всех ролей, и именно туда человек идёт, когда ищет «как это настроить».

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const [large, setLarge] = useState(isLargeFont)
  useBackButton(onBack)

  return (
    <div className="screen">
      <ScreenHeader title={t('settingsTitle')} />

      <section className="card">
        <div className="settings-head">
          <Tile tone="teal">
            <IconTextSize size={17} />
          </Tile>
          <b>{t('fontTitle')}</b>
        </div>
        <p className="hint">{t('fontHint')}</p>
        <div className="chips-grid">
          {[false, true].map((value) => (
            <button
              key={String(value)}
              type="button"
              className="chip"
              aria-pressed={large === value}
              onClick={() => {
                haptic.select()
                applyFontScale(value)
                setLarge(value)
              }}
            >
              {value ? t('fontLarge') : t('fontNormal')}
            </button>
          ))}
        </div>
      </section>

      {/* Язык и тема не настраиваются здесь намеренно: своя настройка разошлась бы с
          клиентом, и мини-апп заговорил бы по-русски посреди казахского Telegram. */}
      <section className="card">
        <h2>{t('settingsFromTelegramTitle')}</h2>
        <p className="hint">{t('settingsFromTelegram')}</p>
      </section>

      <p className="footnote">{t('aboutVersion', { version: __APP_VERSION__ })}</p>
    </div>
  )
}
