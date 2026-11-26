// Отдельно от barrel shared/lib: модуль нужен только экранам входа по ЭЦП и её привязки.
export {
  NCALAYER_DOWNLOAD_URL,
  NCALAYER_URL,
  NcaLayerError,
  isNcaLayerError,
  isNcaLayerPlatform,
  ncaLayerLocale,
  openNcaLayer,
  signChallengeWithNcaLayer,
  withNcaLayer,
  type NcaLayerErrorKind,
  type NcaLayerOptions,
  type NcaLayerSession,
  type NcaLayerSocket,
  type NcaLayerSocketFactory,
  type SignedChallenge,
} from './ncalayer-client'
export { useNcaLayerSupported } from './use-ncalayer-supported'
