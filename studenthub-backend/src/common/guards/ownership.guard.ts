import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../services/prisma.service';

export const OWNERSHIP_KEY = 'ownership';
export const Ownership = (resource: string, idParam: string = 'id') =>
  SetMetadata(OWNERSHIP_KEY, { resource, idParam });

@Injectable()
export class OwnershipGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ownership = this.reflector.get<{ resource: string; idParam: string }>(
      OWNERSHIP_KEY,
      context.getHandler(),
    );

    if (!ownership) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const resourceId = request.params[ownership.idParam];

    if (!user || !resourceId) {
      throw new ForbiddenException('Access denied');
    }

    // Check ownership based on resource type
    const isOwner = await this.checkOwnership(
      ownership.resource,
      resourceId,
      user.id,
    );

    if (!isOwner) {
      throw new ForbiddenException('You can only access your own resources');
    }

    return true;
  }

  private async checkOwnership(
    resource: string,
    resourceId: string,
    userId: string,
  ): Promise<boolean> {
    switch (resource) {
      case 'post':
        const post = await this.prisma.post.findUnique({
          where: { id: resourceId },
          select: { authorId: true },
        });
        return post?.authorId === userId;

      case 'comment':
        const comment = await this.prisma.comment.findUnique({
          where: { id: resourceId },
          select: { authorId: true },
        });
        return comment?.authorId === userId;

      case 'story':
        const story = await this.prisma.story.findUnique({
          where: { id: resourceId },
          select: { authorId: true },
        });
        return story?.authorId === userId;

      case 'message':
        const message = await this.prisma.message.findUnique({
          where: { id: resourceId },
          select: { senderId: true },
        });
        return message?.senderId === userId;

      case 'groupMessage':
        const groupMessage = await this.prisma.groupMessage.findUnique({
          where: { id: resourceId },
          select: { senderId: true },
        });
        return groupMessage?.senderId === userId;

      case 'document':
        const document = await this.prisma.document.findUnique({
          where: { id: resourceId },
          select: { ownerId: true },
        });
        return document?.ownerId === userId;

      case 'event':
        const event = await this.prisma.event.findUnique({
          where: { id: resourceId },
          select: { universityId: true },
        });
        // Check if user is admin of the university
        if (!event) return false;
        const userAdmin = await this.prisma.universityAdmin.findFirst({
          where: {
            userId,
            universityId: event.universityId,
          },
        });
        return !!userAdmin;

      default:
        return false;
    }
  }
}

