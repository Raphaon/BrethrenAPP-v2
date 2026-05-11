import { AnnouncementLevel, CommentTargetType, Prisma } from '@prisma/client';
import { Request } from 'express';
import { prisma } from '../../database/prisma';
import { AppError, ForbiddenError, NotFoundError } from '../../middlewares/error.middleware';
import { userHasPermission } from '../../middlewares/rbac.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import type { AuthUser } from '../../shared/types/express';
import { createAuditLog } from '../../utils/audit.util';
import {
  assertAnnouncementTargetScope,
  assertCircularTargetScope,
  assertEventTargetScope,
  buildAnnouncementVisibilityFilter,
  buildCircularVisibilityFilter,
  buildEventVisibilityFilter,
  buildNewsPostVisibilityFilter,
} from '../../utils/scope-access.util';
import type { CreateCommentDto } from './comments.validation';

export type CommentTarget = 'announcement' | 'circular' | 'event' | 'news';

type AccessibleTarget =
  | {
      kind: 'announcement';
      entity: {
        id: string;
        title: string;
        status: string;
        level: AnnouncementLevel;
        regionId: string | null;
        districtId: string | null;
        assemblyId: string | null;
        ministryId: string | null;
      };
    }
  | {
      kind: 'circular';
      entity: {
        id: string;
        title: string;
        status: string;
        level: string;
        regionId: string | null;
        districtId: string | null;
      };
    }
  | {
      kind: 'event';
      entity: {
        id: string;
        title: string;
        status: string;
        level: string;
        regionId: string | null;
        districtId: string | null;
        assemblyId: string | null;
      };
    }
  | {
      kind: 'news';
      entity: {
        id: string;
        title: string;
        status: string;
        allowComments: boolean;
        level: AnnouncementLevel;
        regionId: string | null;
        districtId: string | null;
        assemblyId: string | null;
        ministryId: string | null;
      };
    };

const commentAuthorSelect = {
  id: true,
  firstName: true,
  lastName: true,
  avatar: true,
} satisfies Prisma.UserSelect;

function getTargetType(target: CommentTarget): CommentTargetType {
  switch (target) {
    case 'announcement':
      return 'ANNOUNCEMENT';
    case 'circular':
      return 'CIRCULAR';
    case 'event':
      return 'EVENT';
    case 'news':
      return 'NEWS_POST';
  }
}

function getTargetWritePermission(target: CommentTarget) {
  switch (target) {
    case 'announcement':
      return PERMISSIONS.ANNOUNCEMENTS_WRITE;
    case 'circular':
      return PERMISSIONS.CIRCULARS_WRITE;
    case 'event':
      return PERMISSIONS.EVENTS_WRITE;
    case 'news':
      return PERMISSIONS.NEWS_WRITE;
  }
}

async function findAccessibleTarget(target: CommentTarget, targetId: string, user: AuthUser): Promise<AccessibleTarget> {
  if (target === 'announcement') {
    const visibilityWhere = await buildAnnouncementVisibilityFilter(user);
    const entity = await prisma.announcement.findFirst({
      where: { id: targetId, deletedAt: null, ...visibilityWhere },
      select: {
        id: true,
        title: true,
        status: true,
        level: true,
        regionId: true,
        districtId: true,
        assemblyId: true,
        ministryId: true,
      },
    });

    if (!entity) throw new NotFoundError('Annonce');
    return { kind: 'announcement', entity };
  }

  if (target === 'circular') {
    const visibilityWhere = await buildCircularVisibilityFilter(user);
    const entity = await prisma.circular.findFirst({
      where: { id: targetId, deletedAt: null, ...visibilityWhere },
      select: {
        id: true,
        title: true,
        status: true,
        level: true,
        regionId: true,
        districtId: true,
      },
    });

    if (!entity) throw new NotFoundError('Circulaire');
    return { kind: 'circular', entity };
  }

  if (target === 'event') {
    const visibilityWhere = await buildEventVisibilityFilter(user);
    const entity = await prisma.event.findFirst({
      where: { id: targetId, deletedAt: null, ...visibilityWhere },
      select: {
        id: true,
        title: true,
        status: true,
        level: true,
        regionId: true,
        districtId: true,
        assemblyId: true,
      },
    });

    if (!entity) throw new NotFoundError('Evenement');
    return { kind: 'event', entity };
  }

  const visibilityWhere = await buildNewsPostVisibilityFilter(user);
  const entity = await prisma.newsPost.findFirst({
    where: { id: targetId, deletedAt: null, ...visibilityWhere },
    select: {
      id: true,
      title: true,
      status: true,
      allowComments: true,
      level: true,
      regionId: true,
      districtId: true,
      assemblyId: true,
      ministryId: true,
    },
  });

  if (!entity) throw new NotFoundError('Actualite');
  return { kind: 'news', entity };
}

async function assertTargetModerationAccess(target: AccessibleTarget, user: AuthUser): Promise<void> {
  if (!userHasPermission(user, getTargetWritePermission(target.kind))) {
    throw new ForbiddenError('Vous ne pouvez pas moderer les commentaires de ce contenu');
  }

  if (target.kind === 'announcement') {
    await assertAnnouncementTargetScope(user, target.entity);
    return;
  }

  if (target.kind === 'circular') {
    await assertCircularTargetScope(user, target.entity);
    return;
  }

  if (target.kind === 'news') {
    await assertAnnouncementTargetScope(user, target.entity);
    return;
  }

  await assertEventTargetScope(user, target.entity);
}

function getCommentWhere(target: CommentTarget, targetId: string): Prisma.CommentWhereInput {
  switch (target) {
    case 'announcement':
      return { targetType: 'ANNOUNCEMENT', announcementId: targetId, deletedAt: null };
    case 'circular':
      return { targetType: 'CIRCULAR', circularId: targetId, deletedAt: null };
    case 'event':
      return { targetType: 'EVENT', eventId: targetId, deletedAt: null };
    case 'news':
      return { targetType: 'NEWS_POST', newsPostId: targetId, deletedAt: null };
  }
}

function getCommentCreateData(
  target: CommentTarget,
  targetId: string,
  content: string,
  authorId: string,
  parentId?: string | null,
): Prisma.CommentUncheckedCreateInput {
  switch (target) {
    case 'announcement':
      return { content, authorId, parentId, targetType: 'ANNOUNCEMENT', announcementId: targetId };
    case 'circular':
      return { content, authorId, parentId, targetType: 'CIRCULAR', circularId: targetId };
    case 'event':
      return { content, authorId, parentId, targetType: 'EVENT', eventId: targetId };
    case 'news':
      return { content, authorId, parentId, targetType: 'NEWS_POST', newsPostId: targetId };
  }
}

async function resolveParentCommentId(target: CommentTarget, targetId: string, parentId?: string | null) {
  if (!parentId) return null;

  const parent = await prisma.comment.findFirst({
    where: {
      id: parentId,
      parentId: null,
      ...getCommentWhere(target, targetId),
    },
    select: { id: true },
  });

  if (!parent) {
    throw new AppError('Le commentaire auquel vous repondez est introuvable', 404, 'PARENT_COMMENT_NOT_FOUND');
  }

  return parent.id;
}

export class CommentsService {
  async list(target: CommentTarget, targetId: string, user: AuthUser) {
    await findAccessibleTarget(target, targetId, user);

    return prisma.comment.findMany({
      where: { ...getCommentWhere(target, targetId), parentId: null },
      include: {
        author: { select: commentAuthorSelect },
        other_comments: {
          where: { deletedAt: null },
          include: { author: { select: commentAuthorSelect } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(target: CommentTarget, targetId: string, dto: CreateCommentDto, user: AuthUser, req: Request) {
    const accessibleTarget = await findAccessibleTarget(target, targetId, user);

    if (accessibleTarget.kind === 'news' && !accessibleTarget.entity.allowComments) {
      throw new AppError('Les commentaires sont desactives sur ce contenu', 400, 'COMMENTS_DISABLED');
    }

    if (accessibleTarget.entity.status !== 'PUBLISHED') {
      throw new AppError('Les commentaires sont disponibles uniquement sur les contenus publies', 400, 'COMMENTS_DISABLED');
    }

    let parentId: string | null = null;
    if (dto.parentId) {
      parentId = await resolveParentCommentId(target, targetId, dto.parentId);
    }

    const comment = await prisma.comment.create({
      data: { ...getCommentCreateData(target, targetId, dto.content, user.id), parentId: parentId ?? null },
      include: {
        author: { select: commentAuthorSelect },
      },
    });

    await createAuditLog({
      actorId: user.id,
      action: 'CREATE',
      entityType: 'Comment',
      entityId: comment.id,
      newValues: { targetType: getTargetType(target), targetId, content: dto.content },
      req,
    });

    return comment;
  }

  async remove(target: CommentTarget, targetId: string, commentId: string, user: AuthUser, req: Request) {
    const accessibleTarget = await findAccessibleTarget(target, targetId, user);
    const existing = await prisma.comment.findFirst({
      where: { id: commentId, ...getCommentWhere(target, targetId) },
      select: { id: true, authorId: true, content: true },
    });

    if (!existing) {
      throw new NotFoundError('Commentaire');
    }

    if (existing.authorId !== user.id) {
      await assertTargetModerationAccess(accessibleTarget, user);
    }

    await prisma.comment.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });

    await createAuditLog({
      actorId: user.id,
      action: 'DELETE',
      entityType: 'Comment',
      entityId: existing.id,
      oldValues: { content: existing.content, targetType: getTargetType(target), targetId },
      req,
    });
  }
}

export const commentsService = new CommentsService();
