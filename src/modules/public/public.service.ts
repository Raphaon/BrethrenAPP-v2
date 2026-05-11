import crypto from 'crypto';
import { Request } from 'express';
import { Prisma, UserStatus } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { AppError, ConflictError } from '../../middlewares/error.middleware';
import { hashPassword } from '../../utils/password.util';
import { getRefreshTokenExpiryDate, signAccessToken, signRefreshToken } from '../../utils/jwt.util';
import { createAuditLog } from '../../utils/audit.util';
import { emailService } from '../../services/email.service';
import type { SignupDto } from './public.validation';

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || `tenant-${crypto.randomUUID().slice(0, 8)}`;
}

async function uniqueTenantSlug(baseName: string): Promise<string> {
  const base = slugify(baseName);
  let slug = base;
  let counter = 2;

  while (await prisma.tenant.findUnique({ where: { slug } })) {
    slug = `${base}-${counter}`;
    counter += 1;
  }

  return slug;
}

async function ensureTenantOwnerRole(tx: Prisma.TransactionClient) {
  const allPermissions = await tx.permission.findMany({ select: { id: true } });
  const role = await tx.role.upsert({
    where: { name: 'tenant_owner' },
    update: {
      displayName: "Responsable de l'organisation",
      description: "Gestion complète de l'organisation, de la formule et des paramètres",
      level: 1,
      isSystem: true,
    },
    create: {
      name: 'tenant_owner',
      displayName: "Responsable de l'organisation",
      description: "Gestion complète de l'organisation, de la formule et des paramètres",
      level: 1,
      isSystem: true,
    },
  });

  if (allPermissions.length) {
    await tx.rolePermission.createMany({
      data: allPermissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
      skipDuplicates: true,
    });
  }

  return role;
}

export class PublicService {
  async listPlans() {
    return prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { monthlyPriceCents: 'asc' },
    });
  }

  async signup(dto: SignupDto, req: Request) {
    const existingUser = await prisma.user.findUnique({ where: { email: dto.email } });
    if (existingUser) {
      throw new ConflictError('Un compte existe deja avec cet email');
    }

    const freePlan = await prisma.plan.findUnique({ where: { code: 'FREE' } });
  if (!freePlan) {
    throw new AppError("Formule gratuite non configurée. Lancez l'initialisation des formules.", 500, 'PLAN_NOT_CONFIGURED');
  }

    const slug = await uniqueTenantSlug(dto.organizationName);
    const password = await hashPassword(dto.password);
    const refreshTokenValue = crypto.randomUUID();

    const result = await prisma.$transaction(async (tx) => {
      const ownerRole = await ensureTenantOwnerRole(tx);

      const tenant = await tx.tenant.create({
        data: {
          id: crypto.randomUUID(),
          updatedAt: new Date(),
          name: dto.organizationName,
          slug,
          country: dto.country ?? null,
          currency: dto.currency ?? 'XAF',
          language: dto.language ?? 'fr',
          timezone: dto.timezone ?? 'Africa/Douala',
          tenantSettings: {
            create: {
              id: crypto.randomUUID(),
              updatedAt: new Date(),
              contactEmail: dto.email,
              onboardingChecklist: {
                organizationCreated: true,
                firstAssemblyCreated: true,
                addLogo: false,
                addFiveMembers: false,
                createMinistries: false,
                publishAnnouncement: false,
                inviteAdmin: false,
              },
            },
          },
        },
      });

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: dto.email,
          phone: dto.phone ?? null,
          firstName: dto.firstName,
          lastName: dto.lastName,
          password,
          status: UserStatus.ACTIVE,
        },
      });

      await tx.tenant.update({
        where: { id: tenant.id },
        data: { ownerId: user.id },
      });

      await tx.subscription.create({
        data: {
          id: crypto.randomUUID(),
          updatedAt: new Date(),
          tenantId: tenant.id,
          planId: freePlan.id,
          status: 'ACTIVE',
        },
      });

      const region = await tx.region.create({
        data: {
          tenantId: tenant.id,
          name: 'Region principale',
          code: `${slug.slice(0, 8).toUpperCase()}-R1`,
          status: 'ACTIVE',
        },
      });

      const district = await tx.district.create({
        data: {
          name: 'District principal',
          code: `${slug.slice(0, 8).toUpperCase()}-D1`,
          regionId: region.id,
          status: 'ACTIVE',
        },
      });

      const assembly = await tx.assembly.create({
        data: {
          name: dto.assemblyName,
          code: `${slug.slice(0, 8).toUpperCase()}-A1`,
          districtId: district.id,
          email: dto.email,
          status: 'ACTIVE',
        },
      });

      await tx.userRole.create({
        data: {
          userId: user.id,
          roleId: ownerRole.id,
          tenantId: tenant.id,
          assignedBy: user.id,
        },
      });

      const refreshToken = await tx.refreshToken.create({
        data: {
          token: refreshTokenValue,
          userId: user.id,
          expiresAt: getRefreshTokenExpiryDate(),
          ipAddress: req.ip ?? null,
          userAgent: req.get('user-agent') ?? null,
        },
      });

      return { tenant, user, assembly, refreshToken };
    });

    await createAuditLog({
      tenantId: result.tenant.id,
      actorId: result.user.id,
      action: 'CREATE',
      entityType: 'Tenant',
      entityId: result.tenant.id,
      newValues: { name: result.tenant.name, slug: result.tenant.slug, plan: 'FREE' },
      req,
    });

    // Envoyer l'email de vérification en arrière-plan (non bloquant)
    this.sendVerificationEmail(result.user.id, result.user.email, result.user.firstName).catch(() => {});

    const accessToken = signAccessToken(result.user.id, result.user.email);
    const refreshToken = signRefreshToken(result.user.id, result.refreshToken.id);

    return {
      accessToken,
      refreshToken,
      expiresIn: 900,
      tenant: {
        id: result.tenant.id,
        name: result.tenant.name,
        slug: result.tenant.slug,
        plan: { code: freePlan.code, name: freePlan.name },
      },
      assembly: result.assembly,
      user: {
        id: result.user.id,
        tenantId: result.tenant.id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        status: result.user.status,
        tenant: {
          id: result.tenant.id,
          name: result.tenant.name,
          slug: result.tenant.slug,
          status: result.tenant.status,
          plan: { code: freePlan.code, name: freePlan.name },
        },
        roles: [
          {
            role: {
              name: 'tenant_owner',
              level: 1,
              rolePermissions: [],
            },
            tenantId: result.tenant.id,
            regionId: null,
            districtId: null,
            assemblyId: null,
            ministryId: null,
          },
        ],
      },
    };
  }

  private async sendVerificationEmail(userId: string, email: string, firstName: string): Promise<void> {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    await prisma.emailVerificationToken.create({
      data: { id: crypto.randomUUID(), token: tokenHash, userId, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    });
    await emailService.sendEmailVerification(email, rawToken, firstName);
  }
}

export const publicService = new PublicService();
