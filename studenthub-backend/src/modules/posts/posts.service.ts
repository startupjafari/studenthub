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
import { CreatePostDto, UpdatePostDto, GetPostsDto } from './dto';
import { PaginatedResponse } from '../../common/dto/pagination.dto';
import { PostVisibility } from '@prisma/client';
import { TagsService } from '../tags/tags.service';
import { MentionsService } from '../mentions/mentions.service';

@Injectable()
export class PostsService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
    @Inject(forwardRef(() => TagsService))
    private tagsService: TagsService,
    @Inject(forwardRef(() => MentionsService))
    private mentionsService: MentionsService,
  ) {}

  /**
   * Create post
   */
  async createPost(userId: string, dto: CreatePostDto) {
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

    const post = await this.prisma.post.create({
      data: {
        authorId: userId,
        content: dto.content,
        visibility: dto.visibility || PostVisibility.PUBLIC,
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
        tags: {
          include: {
            tag: true,
          },
        },
        _count: {
          select: {
            comments: true,
            reactions: true,
          },
        },
      },
    });

    // Process tags
    const tagNames = this.tagsService.extractTagsFromText(dto.content);
    if (tagNames.length > 0) {
      for (const tagName of tagNames) {
        const tag = await this.tagsService.createOrGetTag({ name: tagName });
        await this.prisma.postTag.create({
          data: {
            postId: post.id,
            tagId: tag.id,
          },
        });
        await this.tagsService.incrementUsageCount(tag.id);
      }
    }

    // Process mentions
    await this.mentionsService.createPostMentions(post.id, dto.content, userId);

    // Invalidate feed cache
    await this.cache.deletePattern('feed:*');

    return post;
  }

  /**
   * Get posts feed
   */
  async getPostsFeed(dto: GetPostsDto, userId: string) {
    const cacheKey = `feed:${userId}:${dto.page}`;
    const cached = await this.cache.get(cacheKey);

    if (cached) {
      return cached;
    }

    // Get user's friends
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        friends: {
          select: { id: true },
        },
      },
    });

    const friendIds = user?.friends.map((f) => f.id) || [];

    // Build where clause based on visibility
    const where: any = {
      OR: [
        // Public posts
        { visibility: PostVisibility.PUBLIC },
        // User's own posts
        { authorId: userId },
        // Friends-only posts from friends
        {
          AND: [{ visibility: PostVisibility.FRIENDS_ONLY }, { authorId: { in: friendIds } }],
        },
      ],
    };

    const [posts, total] = await Promise.all([
      this.prisma.post.findMany({
        where,
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
              comments: true,
              reactions: true,
            },
          },
        },
        skip: dto.skip,
        take: dto.take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.post.count({ where }),
    ]);

    const result = new PaginatedResponse(posts, total, dto);

    // Cache for 5 minutes
    await this.cache.set(cacheKey, result, 300);

    return result;
  }

  /**
   * Get post by ID
   */
  async getPostById(postId: string, userId: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
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
        comments: {
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
          orderBy: { createdAt: 'asc' },
        },
        reactions: {
          include: {
            user: {
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

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    // Check visibility
    if (!(await this.canViewPost(post, userId))) {
      throw new ForbiddenException('You do not have permission to view this post');
    }

    return post;
  }

  /**
   * Get user's posts
   */
  async getUserPosts(userId: string, targetUserId: string, dto: GetPostsDto) {
    // Check if viewing own posts or friend's posts
    const isOwnPosts = userId === targetUserId;
    const isFriend = await this.areFriends(userId, targetUserId);

    const where: any = {
      authorId: targetUserId,
    };

    if (!isOwnPosts) {
      // Filter by visibility
      where.OR = [
        { visibility: PostVisibility.PUBLIC },
        ...(isFriend ? [{ visibility: PostVisibility.FRIENDS_ONLY }] : []),
      ];
    }

    const [posts, total] = await Promise.all([
      this.prisma.post.findMany({
        where,
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
              comments: true,
              reactions: true,
            },
          },
        },
        skip: dto.skip,
        take: dto.take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.post.count({ where }),
    ]);

    return new PaginatedResponse(posts, total, dto);
  }

  /**
   * Update post
   */
  async updatePost(postId: string, userId: string, dto: UpdatePostDto) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (post.authorId !== userId) {
      throw new ForbiddenException('You can only edit your own posts');
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

    const updated = await this.prisma.post.update({
      where: { id: postId },
      data: {
        ...(dto.content && { content: dto.content }),
        ...(dto.visibility && { visibility: dto.visibility }),
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
            comments: true,
            reactions: true,
          },
        },
      },
    });

    // Invalidate cache
    await this.cache.invalidatePostCache(postId, userId);

    return updated;
  }

  /**
   * Delete post
   */
  async deletePost(postId: string, userId: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (post.authorId !== userId) {
      throw new ForbiddenException('You can only delete your own posts');
    }

    await this.prisma.post.delete({
      where: { id: postId },
    });

    // Invalidate cache
    await this.cache.invalidatePostCache(postId, userId);

    return { message: 'Post deleted successfully' };
  }

  /**
   * Check if user can view post
   */
  private async canViewPost(post: any, userId: string): Promise<boolean> {
    if (post.authorId === userId) {
      return true;
    }

    if (post.visibility === PostVisibility.PUBLIC) {
      return true;
    }

    if (post.visibility === PostVisibility.PRIVATE) {
      return false;
    }

    // For FRIENDS_ONLY, check if users are friends
    return await this.areFriends(userId, post.authorId);
  }

  /**
   * Check if two users are friends
   */
  private async areFriends(userId1: string, userId2: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId1 },
      select: {
        friends: {
          where: { id: userId2 },
        },
      },
    });

    return user?.friends && user.friends.length > 0;
  }
}
