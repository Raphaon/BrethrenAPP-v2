import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { requireAssemblyScope } from '../../middlewares/scope.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import {
  listMembers, getMember, createMember, updateMember, deleteMember, getMemberHistory,
} from './members.controller';
import { createMemberSchema, updateMemberSchema, listMembersQuerySchema } from './members.validation';
import { prisma } from '../../database/prisma';
import { NotFoundError } from '../../middlewares/error.middleware';
import { sendSuccess, sendCreated } from '../../utils/response.util';
import { generateMatricule } from '../../utils/matricule.util';
import { createAuditLog } from '../../utils/audit.util';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission(PERMISSIONS.MEMBERS_READ), validate(listMembersQuerySchema, 'query'), listMembers);
router.get('/:id', requirePermission(PERMISSIONS.MEMBERS_READ), getMember);
router.get('/:id/history', requirePermission(PERMISSIONS.MEMBERS_READ), getMemberHistory);
router.post('/', requirePermission(PERMISSIONS.MEMBERS_WRITE), requireAssemblyScope, validate(createMemberSchema), createMember);
router.patch('/:id', requirePermission(PERMISSIONS.MEMBERS_WRITE), validate(updateMemberSchema), updateMember);
router.delete('/:id', requirePermission(PERMISSIONS.MEMBERS_DELETE), deleteMember);

// Import CSV (JSON array of rows parsed on frontend)
const importRowSchema = createMemberSchema.extend({
  assemblyId: z.string().uuid(),
});
const importBodySchema = z.object({ rows: z.array(importRowSchema).min(1).max(500) });

router.post('/import', requirePermission(PERMISSIONS.MEMBERS_WRITE), validate(importBodySchema), async (req, res, next) => {
  try {
    const { rows } = req.body as z.infer<typeof importBodySchema>;
    const results: { ok: number; errors: { row: number; message: string }[] } = { ok: 0, errors: [] };

    for (let i = 0; i < rows.length; i++) {
      try {
        const dto = rows[i];
        const assembly = await prisma.assembly.findUnique({ where: { id: dto.assemblyId, deletedAt: null } });
        if (!assembly) { results.errors.push({ row: i + 1, message: 'Assemblée introuvable' }); continue; }

        const matricule = await generateMatricule(assembly.code ?? undefined);
        await prisma.member.create({
          data: {
            ...dto,
            matricule,
            birthDate: dto.birthDate ? new Date(dto.birthDate as string) : null,
            salvationDate: dto.salvationDate ? new Date(dto.salvationDate as string) : null,
            baptismDate: dto.baptismDate ? new Date(dto.baptismDate as string) : null,
            memberSince: dto.memberSince ? new Date(dto.memberSince as string) : null,
          },
        });
        results.ok++;
      } catch (err) {
        results.errors.push({ row: i + 1, message: err instanceof Error ? err.message : 'Erreur' });
      }
    }

    await createAuditLog({ actorId: req.user!.id, action: 'CREATE', entityType: 'Member', entityId: 'batch-import', newValues: { count: results.ok }, req });
    sendCreated(res, results, `${results.ok} membre(s) importé(s)`);
  } catch (err) {
    next(err);
  }
});

// Carte membre (données structurées pour génération QR côté client)
router.get('/:id/card', requirePermission(PERMISSIONS.MEMBERS_READ), async (req, res, next) => {
  try {
    const member = await prisma.member.findUnique({
      where: { id: req.params['id'], deletedAt: null },
      select: {
        id: true,
        matricule: true,
        firstName: true,
        lastName: true,
        gender: true,
        photo: true,
        status: true,
        memberSince: true,
        assembly: { select: { id: true, name: true, district: { select: { name: true, region: { select: { name: true } } } } } },
        pastor: { select: { title: true } },
      },
    });
    if (!member) throw new NotFoundError('Membre');

    const card = {
      id: member.id,
      matricule: member.matricule,
      fullName: `${member.firstName} ${member.lastName}`,
      gender: member.gender,
      photo: member.photo,
      status: member.status,
      memberSince: member.memberSince,
      assembly: member.assembly.name,
      district: member.assembly.district.name,
      region: member.assembly.district.region.name,
      title: member.pastor?.title ?? null,
      // QR payload — clients scan this to verify membership
      qrPayload: `brethren://members/${member.id}?matricule=${member.matricule}`,
    };

    sendSuccess(res, card);
  } catch (err) {
    next(err);
  }
});

export default router;
