import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { CacheService } from '../../common/services/cache.service';
import { CreateMessageDto, GetMessagesDto } from './dto';
import { PaginatedResponse } from '../../common/dto/pagination.dto';
import { MessagesGateway } from '../websocket/gateways/messages.gateway';

@Injectable()
export class MessagesService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
    @Inject(forwardRef(() => MessagesGateway))
    private messagesGateway: MessagesGateway,
  ) {}

  /**
   * Send message in conversation
   */
  async sendMessage(
    conversationId: string,
    userId: string,
    dto: CreateMessageDto,
  ) {
    // Check if conversation exists and user is participant
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        participants: {
          select: { id: true },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const isParticipant = conversation.participants.some((p) => p.id === userId);
    if (!isParticipant) {
      throw new ForbiddenException('You are not a participant of this conversation');
    }

    if (!dto.content && !dto.mediaId) {
      throw new BadRequestException('Message must have content or media');
    }

    // Validate media if provided
    if (dto.mediaId) {
      const media = await this.prisma.media.findUnique({
        where: { id: dto.mediaId },
      });

      if (!media) {
        throw new NotFoundException('Media not found');
      }
    }

    // Get receiver (for PRIVATE conversations)
    let receiverId: string | null = null;
    if (conversation.type === 'PRIVATE') {
      receiverId =
        conversation.participants.find((p) => p.id !== userId)?.id || null;
    }

    // Create message
    const message = await this.prisma.message.create({
      data: {
        conversationId,
        senderId: userId,
        receiverId,
        content: dto.content,
        mediaId: dto.mediaId,
      },
      include: {
        sender: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        media: true,
      },
    });

    // Update conversation lastMessage
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageId: message.id,
        updatedAt: new Date(),
      },
    });

    // Create notification for other participants
    const otherParticipants = conversation.participants.filter(
      (p) => p.id !== userId,
    );

    for (const participant of otherParticipants) {
      await this.prisma.notification.create({
        data: {
          recipientId: participant.id,
          type: 'MESSAGE',
          title: 'New Message',
          message: 'You have a new message',
          data: {
            conversationId,
            messageId: message.id,
            senderId: userId,
          },
        },
      });
    }

    // Emit WebSocket event
    if (this.messagesGateway) {
      this.messagesGateway.emitNewMessage(conversationId, message);
    }

    return message;
  }

  /**
   * Get messages in conversation
   */
  async getMessages(
    conversationId: string,
    userId: string,
    dto: GetMessagesDto,
  ) {
    // Check if user is participant
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        participants: {
          select: { id: true },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const isParticipant = conversation.participants.some((p) => p.id === userId);
    if (!isParticipant) {
      throw new ForbiddenException('You are not a participant of this conversation');
    }

    const [messages, total] = await Promise.all([
      this.prisma.message.findMany({
        where: {
          conversationId,
          isDeleted: false,
        },
        include: {
          sender: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true,
            },
          },
          media: true,
        },
        skip: dto.skip,
        take: dto.take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.message.count({
        where: {
          conversationId,
          isDeleted: false,
        },
      }),
    ]);

    return new PaginatedResponse(messages.reverse(), total, dto);
  }

  /**
   * Update message (only author)
   */
  async updateMessage(messageId: string, userId: string, content: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (message.senderId !== userId) {
      throw new ForbiddenException('You can only edit your own messages');
    }

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        content,
        isEdited: true,
      },
      include: {
        sender: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        media: true,
      },
    });

    // Emit WebSocket event
    if (this.messagesGateway) {
      this.messagesGateway.emitMessageEdit(message.conversationId, updated);
    }

    return updated;
  }

  /**
   * Delete message (only author, soft delete)
   */
  async deleteMessage(messageId: string, userId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (message.senderId !== userId) {
      throw new ForbiddenException('You can only delete your own messages');
    }

    await this.prisma.message.update({
      where: { id: messageId },
      data: { isDeleted: true },
    });

    // Emit WebSocket event
    if (this.messagesGateway) {
      this.messagesGateway.emitMessageDelete(message.conversationId, messageId);
    }

    return { message: 'Message deleted successfully' };
  }
}

