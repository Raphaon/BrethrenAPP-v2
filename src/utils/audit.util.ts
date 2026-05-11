import { AuditAction, Prisma } from '@prisma/client';
import { Request } from 'express';
import { prisma } from '../database/prisma';
import { logger } from './logger';

export interface CreateAuditLogParams {
  tenantId?: string | null;
  actorId?: string;
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  req?: Request;
}

export async function createAuditLog(params: CreateAuditLogParams): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: params.actorId ?? null,
        tenantId: params.tenantId ?? params.req?.user?.tenantId ?? null,
        action: params.action,
        entityType: params.entityType ?? null,
        entityId: params.entityId ?? null,
        oldValues: params.oldValues ? (params.oldValues as Prisma.InputJsonValue) : undefined,
        newValues: params.newValues ? (params.newValues as Prisma.InputJsonValue) : undefined,
        metadata: params.metadata ? (params.metadata as Prisma.InputJsonValue) : undefined,
        ipAddress: params.req?.ip ?? null,
        userAgent: params.req?.get('user-agent') ?? null,
      },
    });
  } catch (err) {
    // Audit log failure must never crash the main operation
    logger.error({ err }, 'Failed to write audit log');
  }
}
