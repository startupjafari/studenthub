import { Global, Module } from '@nestjs/common'
import { EdsVerifier } from './eds-verifier'
import { NcaNodeEdsVerifier } from './ncanode-eds-verifier'

// Проверка ЭЦП НУЦ РК (docs/PROJECT.md §8.3 «Вход по ЭЦП»). Глобальный, как TelegramModule:
// подпись проверяют и вход, и привязка ключа в профиле, а тянуть ради этого друг в друга
// модули auth и users — путь к кольцу импортов.
//
// Потребители зависят от абстрактного EdsVerifier, не от NCANode: в тестах его подменяют
// фейком (overrideProvider(EdsVerifier)), не поднимая NCANode. Выключенный вход
// (EDS_LOGIN_ENABLED=false) модуль не прячет — verifyAuthSignature сама отвечает
// FEATURE_DISABLED, так что подключать его можно безусловно.
@Global()
@Module({
  providers: [{ provide: EdsVerifier, useClass: NcaNodeEdsVerifier }],
  exports: [EdsVerifier],
})
export class EdsModule {}
