import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { CreateConversationDto } from './dto';
import { ConversationType } from '@prisma/client';

@Injectable()
export class ConversationsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Create or get existing conversation
   */
  async createConversation(userId: string, dto: CreateConversationDto) {
    if (dto.type === ConversationType.PRIVATE) {
      if (dto.participantIds.length !== 1) {
        throw new BadRequestException('Private conversation must have exactly 1 participant');
      }

      const participantId = dto.participantIds[0];
      if (participantId === userId) {
        throw new BadRequestException('Cannot create conversation with yourself');
      }

      // Check if conversation already exists
      const existing = await this.prisma.conversation.findFirst({
        where: {
          type: ConversationType.PRIVATE,
          AND: [
            {
              participants: {
                some: { id: userId },
              },
            },
            {
              participants: {
                some: { id: participantId },
              },
            },
          ],
        },
        include: {
          participants: true,
          lastMessage: {
            include: {
              sender: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  avatar: true,
                },
              },
            },
          },
        },
      });

      if (existing && existing.participants.length === 2) {
        return existing;
      }

      // Create new private conversation
      const conversation = await this.prisma.conversation.create({
        data: {
          type: ConversationType.PRIVATE,
          participants: {
            connect: [{ id: userId }, { id: participantId }],
          },
        },
        include: {
          participants: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true,
            },
          },
        },
      });

      return conversation;
    } else {
      // GROUP conversation
      if (dto.participantIds.length < 1) {
        throw new BadRequestException('Group conversation must have at least 1 participant');
      }

      const conversation = await this.prisma.conversation.create({
        data: {
          type: ConversationType.GROUP,
          name: dto.name,
          participants: {
            connect: [
              { id: userId },
              ...dto.participantIds.map((id) => ({ id })),
            ],
          },
        },
        include: {
          participants: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true,
            },
          },
        },
      });

      return conversation;
    }
  }

  /**
   * Get user's conversations
   */
  async getMyConversations(userId: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        participants: {
          some: {
            id: userId,
          },
        },
      },
      include: {
        participants: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        lastMessage: {
          include: {
            sender: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                avatar: true,
              },
            },
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    return conversations;
  }

  /**
   * Get conversation by ID (only participants)
   */
  async getConversationById(conversationId: string, userId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        participants: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        lastMessage: {
          include: {
            sender: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                avatar: true,
              },
            },
          },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    // Check if user is a participant
    const isParticipant = conversation.participants.some((p) => p.id === userId);
    if (!isParticipant) {
      throw new ForbiddenException('You are not a participant of this conversation');
    }

    return conversation;
  }

  /**
   * Archive conversation
   */
  async archiveConversation(conversationId: string, userId: string) {
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

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { isArchived: true },
    });

    return { message: 'Conversation archived' };
  }
}

