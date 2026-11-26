// Контракт проверки ЭЦП НУЦ РК (docs/PROJECT.md §8.3 «Вход по ЭЦП»). Реализация —
// NcaNodeEdsVerifier (HTTP к NCANode); в тестах подменяется фейком через DI-токен EdsVerifier.

/** Владелец ключа, подпись которого прошла все проверки. */
export interface VerifiedEdsSigner {
  /** ИИН владельца ключа, 12 цифр. Наружу и в логи не уходит — только в HMAC. */
  iin: string
  /** БИН организации у ключа сотрудника юрлица; у ключа физлица — null. */
  orgBin: string | null
  /** CN сертификата — ФИО, как его записал НУЦ. */
  subjectCn: string
  certSerial: string
  /** Издатель (DN или CN), для журнала и показа владельцу. */
  certIssuer: string
  certNotBefore: Date
  certNotAfter: Date
}

/**
 * Проверка открепленной CMS-подписи ключом аутентификации над `data`.
 *
 * Возвращает владельца только если ВСЁ сошлось: подпись открепленная, математически верна
 * и сделана над `data`; сертификат выдан НУЦ РК (цепочка до доверенного корня), действует
 * на текущий момент, не отозван (OCSP/CRL по EDS_REVOCATION_CHECK), предназначен для
 * аутентификации, подписант ровно один. «Для аутентификации» — ключ AUTH_* старой пары
 * (extKeyUsage clientAuth) или единый ключ ГОСТ 2015, который НУЦ выдаёт с 2023 года для
 * входа и подписи сразу (clientAuth у него нет); ключ «только для подписи» — нет
 * (isAuthenticationKey в ncanode-eds-verifier.ts).
 *
 * Иначе бросает AppException: EDS_SIGNATURE_INVALID, EDS_CERT_EXPIRED, EDS_CERT_REVOKED,
 * EDS_CERT_NOT_AUTH; недоступность NCANode — EDS_UNAVAILABLE. Сомнение = отказ.
 */
export abstract class EdsVerifier {
  abstract verifyAuthSignature(cmsBase64: string, data: Buffer): Promise<VerifiedEdsSigner>
}
