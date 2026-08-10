import { SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets'
import { ConnectedSocket, MessageBody } from '@nestjs/websockets'
import type { Server, Socket } from 'socket.io'

const WS_CORS_ORIGIN = (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(',')

// Отдельный namespace для входа по QR: подключение БЕЗ токена (десктоп ещё не авторизован).
// Изолирован от основного '/' (там handshake требует JWT). Десктоп подписывается на комнату
// своей QR-сессии и получает событие qr:approved, когда телефон подтвердит вход.
@WebSocketGateway({ namespace: '/qr-login', cors: { origin: WS_CORS_ORIGIN, credentials: true } })
export class QrLoginGateway {
  @WebSocketServer() private readonly server!: Server

  @SubscribeMessage('qr:subscribe')
  async subscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { qrId?: string },
  ): Promise<void> {
    // qrId знает только инициировавший десктоп (в QR его нет). Событие approved не несёт
    // секрета — забрать сессию всё равно можно лишь с claimSecret, поэтому room по qrId безопасна.
    if (typeof data?.qrId === 'string' && data.qrId.length > 0) {
      await client.join(`qr:${data.qrId}`)
    }
  }

  emitApproved(qrId: string): void {
    this.server.to(`qr:${qrId}`).emit('qr:approved', { qrId })
  }
}
