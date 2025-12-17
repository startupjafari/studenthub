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
import { CreateCommentDto, UpdateCommentDto, GetCommentsDto } from './dto';
import { PaginatedResponse } from '../../common/dto/pagination.dto';
import { MentionsService } from '../mentions/mentions.service';

@Injectable()
export class CommentsService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
    @Inject(forwardRef(() => MentionsService))
    private mentionsService: MentionsService,
  ) {}

  /**
   * Create comment on post
   */
  async createComment(
    postId: string,
    userId: string,
    dto: CreateCommentDto,
  ) {
    // Check if post exists
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
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

    const comment = await this.prisma.comment.create({
      data: {
        postId,
        authorId: userId,
        content: dto.content,
        media: dto.mediaIds
          ? {
              connect: dto.mediaIds.map((id) => ({ id })),
            }
          : undefined,
      },
      include: {
        author: {
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
    });

    // Process mentions
    await this.mentionsService.createCommentMentions(comment.id, dto.content, userId);

    // Create notification for post author
    if (post.authorId !== userId) {
      await this.createNotification(post.authorId, {
        type: 'POST_COMMENT',
        title: 'New Comment',
        message: 'Someone commented on your post',
        data: {
          postId,
          commentId: comment.id,
          authorId: userId,
        },
      });
    }

    // Invalidate post cache
    await this.cache.deletePattern(`post:${postId}*`);
    await this.cache.deletePattern('feed:*');

    return comment;
  }

  /**
   * Get comments for a post
   */
  async getComments(postId: string, dto: GetCommentsDto) {
    // Check if post exists
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    const [comments, total] = await Promise.all([
      this.prisma.comment.findMany({
        where: { postId },
        include: {
          author: {
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
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.comment.count({ where: { postId } }),
    ]);

    return new PaginatedResponse(comments, total, dto);
  }

  /**
   * Update comment
   */
  async updateComment(commentId: string, userId: string, dto: UpdateCommentDto) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    if (comment.authorId !== userId) {
      throw new ForbiddenException('You can only edit your own comments');
    }

    // Handle media updates
    let mediaUpdate: any = undefined;
    if (dto.mediaIds !== undefined) {
      if (dto.mediaIds.length === 0) {
        mediaUpdate = { set: [] };
      } else {
        // Validate media
        const mediaCount = await this.prisma.media.count({
          where: {
            id: { in: dto.mediaIds },
          },
        });

        if (mediaCount !== dto.mediaIds.length) {
          throw new BadRequestException('Some media files not found');
        }

        mediaUpdate = {
          set: dto.mediaIds.map((id) => ({ id })),
        };
      }
    }

    const updated = await this.prisma.comment.update({
      where: { id: commentId },
      data: {
        ...(dto.content && { content: dto.content }),
        ...(mediaUpdate && { media: mediaUpdate }),
      },
      include: {
        author: {
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
    });

    // Invalidate cache
    await this.cache.deletePattern(`post:${comment.postId}*`);

    return updated;
  }

  /**
   * Delete comment
   */
  async deleteComment(commentId: string, userId: string) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    if (comment.authorId !== userId) {
      throw new ForbiddenException('You can only delete your own comments');
    }

    await this.prisma.comment.delete({
      where: { id: commentId },
    });

    // Invalidate cache
    await this.cache.deletePattern(`post:${comment.postId}*`);

    return { message: 'Comment deleted successfully' };
  }

  /**
   * Helper: Create notification
   */
  private async createNotification(
    recipientId: string,
    data: {
      type: string;
      title: string;
      message: string;
      data?: any;
    },
  ) {
    await this.prisma.notification.create({
      data: {
        recipientId,
        type: data.type as any,
        title: data.title,
        message: data.message,
        data: data.data || {},
      },
    });
  }
}





