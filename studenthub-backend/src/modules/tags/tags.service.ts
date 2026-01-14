import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { CacheService } from '../../common/services/cache.service';
import { CreateTagDto, GetTagsDto } from './dto';
import { PaginatedResponse } from '../../common/dto/pagination.dto';

@Injectable()
export class TagsService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
  ) {}

  /**
   * Create or get tag
   */
  async createOrGetTag(dto: CreateTagDto) {
    const slug = this.generateSlug(dto.name);

    // Check if tag exists
    const existing = await this.prisma.tag.findUnique({
      where: { slug },
    });

    if (existing) {
      return existing;
    }

    // Create new tag
    const tag = await this.prisma.tag.create({
      data: {
        name: dto.name,
        slug,
        description: dto.description,
      },
    });

    // Invalidate cache
    await this.cache.deletePattern('tags:*');

    return tag;
  }

  /**
   * Get all tags with pagination
   */
  async getTags(dto: GetTagsDto) {
    const cacheKey = `tags:${dto.page}:${dto.search || ''}`;
    const cached = await this.cache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const where: any = {};

    if (dto.search) {
      where.OR = [
        { name: { contains: dto.search, mode: 'insensitive' } },
        { slug: { contains: dto.search, mode: 'insensitive' } },
      ];
    }

    const [tags, total] = await Promise.all([
      this.prisma.tag.findMany({
        where,
        orderBy: { usageCount: 'desc' },
        skip: dto.skip,
        take: dto.take,
      }),
      this.prisma.tag.count({ where }),
    ]);

    const result = new PaginatedResponse(tags, total, dto);
    await this.cache.set(cacheKey, result, 300); // Cache for 5 minutes

    return result;
  }

  /**
   * Get tag by slug
   */
  async getTagBySlug(slug: string) {
    const tag = await this.prisma.tag.findUnique({
      where: { slug },
      include: {
        _count: {
          select: {
            posts: true,
          },
        },
      },
    });

    if (!tag) {
      throw new NotFoundException('Tag not found');
    }

    return tag;
  }

  /**
   * Get trending tags
   */
  async getTrendingTags(limit: number = 10) {
    const cacheKey = `tags:trending:${limit}`;
    const cached = await this.cache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const tags = await this.prisma.tag.findMany({
      orderBy: { usageCount: 'desc' },
      take: limit,
    });

    await this.cache.set(cacheKey, tags, 600); // Cache for 10 minutes

    return tags;
  }

  /**
   * Extract tags from text (e.g., #tag1 #tag2)
   */
  extractTagsFromText(text: string): string[] {
    const tagRegex = /#(\w+)/g;
    const matches = text.match(tagRegex);
    if (!matches) return [];

    return matches.map((match) => match.substring(1).toLowerCase());
  }

  /**
   * Generate slug from name
   */
  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Increment tag usage count
   */
  async incrementUsageCount(tagId: string) {
    await this.prisma.tag.update({
      where: { id: tagId },
      data: {
        usageCount: {
          increment: 1,
        },
      },
    });
  }

  /**
   * Decrement tag usage count
   */
  async decrementUsageCount(tagId: string) {
    await this.prisma.tag.update({
      where: { id: tagId },
      data: {
        usageCount: {
          decrement: 1,
        },
      },
    });
  }
}




