import { Global, Module } from '@nestjs/common'
import { PasswordService } from './password.service'
import { CryptoService } from './crypto.service'

@Global()
@Module({
  providers: [PasswordService, CryptoService],
  exports: [PasswordService, CryptoService],
})
export class SecurityModule {}
