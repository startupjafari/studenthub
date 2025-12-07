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
import {
  CreateGroupMessageDto,
  GetGroupMessagesDto,
  UpdateGroupMessageDto,
} from './dto';
import { PaginatedResponse } from '../../common/dto/pagination.dto';
import { GroupRole } from '@prisma/client';
import { GroupsGateway } from '../websocket/gateways/groups.gateway';

@Injectable()
export class GroupMessagesService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
    @Inject(forwardRef(() => GroupsGateway))
    private groupsGateway: GroupsGateway,
  ) {}

  /**
   * Send message to group (only members)
   */
  async sendMessage(
    groupId: string,
    userId: string,
    dto: CreateGroupMessageDto,
  ) {
    // Check if user is a member
    const membership = await this.prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException('You are not a member of this group');
    }

    if (!dto.content && (!dto.mediaIds || dto.mediaIds.length === 0)) {
      throw new BadRequestException('Message must have content or media');
    }

    // Validate media if provided
    if (dto.mediaIds && dto.mediaIds.length > 0) {
      const mediaCount = await this.prisma.media.count({
        where: {
          id: { in: dto.mediaIds },
        },
      });

      if (mediaCount !== dto.mediaIds.length) {
        throw new BadRequestException('Some media files not found');
      }
    }

    const message = await this.prisma.groupMessage.create({
      data: {
        groupId,
        senderId: userId,
        content: dto.content,
        media: dto.mediaIds
          ? {
              connect: dto.mediaIds.map((id) => ({ id })),
            }
          : undefined,
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
    if (this.groupsGateway) {
      this.groupsGateway.emitNewMessage(groupId, message);
    }

    return message;
  }

  /**
   * Get group messages (only members)
   */
  async getMessages(groupId: string, userId: string, dto: GetGroupMessagesDto) {
    // Check if user is a member
    const membership = await this.prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException('You are not a member of this group');
    }

    const [messages, total] = await Promise.all([
      this.prisma.groupMessage.findMany({
        where: {
          groupId,
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
          _count: {
            select: {
              reactions: true,
            },
          },
        },
        skip: dto.skip,
        take: dto.take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.groupMessage.count({
        where: {
          groupId,
          isDeleted: false,
        },
      }),
    ]);

    return new PaginatedResponse(messages.reverse(), total, dto);
  }

  /**
   * Update message (only author)
   */
  async updateMessage(
    groupId: string,
    messageId: string,
    userId: string,
    dto: UpdateGroupMessageDto,
  ) {
    const message = await this.prisma.groupMessage.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (message.groupId !== groupId) {
      throw new BadRequestException('Message does not belong to this group');
    }

    if (message.senderId !== userId) {
      throw new ForbiddenException('You can only edit your own messages');
    }

    const updated = await this.prisma.groupMessage.update({
      where: { id: messageId },
      data: {
        content: dto.content,
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
    if (this.groupsGateway) {
      this.groupsGateway.emitMessageEdit(groupId, updated);
    }

    return updated;
  }

  /**
   * Delete message (only author or ADMIN)
   */
  async deleteMessage(groupId: string, messageId: string, userId: string) {
    const message = await this.prisma.groupMessage.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (message.groupId !== groupId) {
      throw new BadRequestException('Message does not belong to this group');
    }

    // Check if user is author or admin
    const membership = await this.prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId,
        },
      },
    });

    if (
      message.senderId !== userId &&
      (!membership || membership.role !== GroupRole.ADMIN)
    ) {
      throw new ForbiddenException(
        'You can only delete your own messages or be an admin',
      );
    }

    await this.prisma.groupMessage.update({
      where: { id: messageId },
      data: { isDeleted: true },
    });

    // Emit WebSocket event
    if (this.groupsGateway) {
      this.groupsGateway.emitMessageDelete(groupId, messageId);
    }

    return { message: 'Message deleted successfully' };
  }
}

