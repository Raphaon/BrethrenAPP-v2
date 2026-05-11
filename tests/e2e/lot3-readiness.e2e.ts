import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/database/prisma';
import { hashPassword } from '../../src/utils/password.util';

const app = createApp();

const seedCredentials = {
  superAdmin: { email: 'admin@mpe-cameroun.org', password: 'Admin@2024!' },
  regionalLeader: { email: 'rachel.ewane@mpe-cameroun.org', password: 'Regional@2024!' },
  districtLeader: { email: 'joseph.minko@mpe-cameroun.org', password: 'District@2024!' },
  pastor: { email: 'pastor.nkomo@mpe-cameroun.org', password: 'Pastor@2024!' },
  assemblyAdmin: { email: 'assembly.admin@mpe-cameroun.org', password: 'Assembly@2024!' },
  ministryLeader: { email: 'ministry.leader@mpe-cameroun.org', password: 'Ministry@2024!' },
};

describe('Lot 3 readiness E2E', () => {
  const suffix = Date.now();
  const tokens: Record<string, string> = {};
  const created = {
    memberId: '',
    memberUserId: '',
    districtId: '',
    assemblyId: '',
    pastorCreatedMemberId: '',
    pastorCreatedUserId: '',
    announcementId: '',
    circularId: '',
    eventId: '',
    commentIds: [] as string[],
    personalEventId: '',
    donationId: '',
    uploadId: '',
    deviceTokenId: '',
  };

  let roleIds: Record<string, string> = {};
  let pastorAssemblyId = '';
  let districtLeaderDistrictId = '';
  let regionalLeaderRegionId = '';
  let outsiderRegionId = '';
  let outsiderDistrictId = '';
  let outsiderAssemblyId = '';

  async function login(email: string, password: string) {
    const response = await request(app).post('/api/v1/auth/login').send({ email, password });
    expect(response.status).toBe(200);
    return response.body.data.accessToken as string;
  }

  beforeAll(async () => {
    const roles = await prisma.role.findMany({
      where: { name: { in: ['member', 'assembly_admin', 'district_leader'] } },
      select: { id: true, name: true },
    });
    roleIds = Object.fromEntries(roles.map((role) => [role.name, role.id]));

    const users = await prisma.user.findMany({
      where: {
        email: {
          in: Object.values(seedCredentials).map((credentials) => credentials.email),
        },
      },
      include: {
        member: { select: { assemblyId: true } },
        userRoles: {
          include: {
            role: { select: { name: true } },
          },
        },
      },
    });

    const pastor = users.find((user) => user.email === seedCredentials.pastor.email)!;
    const districtLeader = users.find((user) => user.email === seedCredentials.districtLeader.email)!;
    const regionalLeader = users.find((user) => user.email === seedCredentials.regionalLeader.email)!;
    const superAdmin = users.find((user) => user.email === seedCredentials.superAdmin.email)!;

    pastorAssemblyId =
      pastor.userRoles.find((userRole) => userRole.role.name === 'assembly_pastor')?.assemblyId ||
      pastor.member?.assemblyId ||
      '';
    districtLeaderDistrictId =
      districtLeader.userRoles.find((userRole) => userRole.role.name === 'district_leader')?.districtId || '';
    regionalLeaderRegionId =
      regionalLeader.userRoles.find((userRole) => userRole.role.name === 'regional_leader')?.regionId || '';

    const outsiderRegion = await prisma.region.findFirst({
      where: { deletedAt: null, id: { not: regionalLeaderRegionId } },
      select: { id: true },
    });
    const outsiderDistrict = await prisma.district.findFirst({
      where: { deletedAt: null, id: { not: districtLeaderDistrictId } },
      select: { id: true },
    });
    const outsiderAssembly = await prisma.assembly.findFirst({
      where: { deletedAt: null, id: { not: pastorAssemblyId } },
      select: { id: true },
    });

    outsiderRegionId = outsiderRegion?.id || '';
    outsiderDistrictId = outsiderDistrict?.id || '';
    outsiderAssemblyId = outsiderAssembly?.id || '';

    tokens.superAdmin = await login(seedCredentials.superAdmin.email, seedCredentials.superAdmin.password);
    tokens.regionalLeader = await login(seedCredentials.regionalLeader.email, seedCredentials.regionalLeader.password);
    tokens.districtLeader = await login(seedCredentials.districtLeader.email, seedCredentials.districtLeader.password);
    tokens.pastor = await login(seedCredentials.pastor.email, seedCredentials.pastor.password);
    tokens.assemblyAdmin = await login(seedCredentials.assemblyAdmin.email, seedCredentials.assemblyAdmin.password);
    tokens.ministryLeader = await login(seedCredentials.ministryLeader.email, seedCredentials.ministryLeader.password);

    const hashed = await hashPassword('MemberLot3@2024');
    const activeMember = await prisma.member.create({
      data: {
        matricule: `LOT3-${suffix}`,
        firstName: 'Simple',
        lastName: 'Member',
        gender: 'MALE',
        assemblyId: pastorAssemblyId,
        status: 'ACTIVE',
        email: `lot3.member.${suffix}@mpe-cameroun.org`,
        memberSince: new Date(),
      },
    });
    created.memberId = activeMember.id;

    const memberUser = await prisma.user.create({
      data: {
        email: `lot3.member.${suffix}@mpe-cameroun.org`,
        firstName: 'Simple',
        lastName: 'Member',
        password: hashed,
        status: 'ACTIVE',
        memberId: activeMember.id,
      },
    });
    created.memberUserId = memberUser.id;

    await prisma.userRole.create({
      data: {
        userId: memberUser.id,
        roleId: roleIds.member,
        assemblyId: pastorAssemblyId,
        assignedBy: superAdmin.id,
      },
    });

    tokens.member = await login(memberUser.email, 'MemberLot3@2024');
  });

  afterAll(async () => {
    if (created.deviceTokenId) {
      await prisma.deviceToken.deleteMany({ where: { id: created.deviceTokenId } }).catch(() => {});
    }
    if (created.commentIds.length) {
      await prisma.comment.deleteMany({ where: { id: { in: created.commentIds } } }).catch(() => {});
    }
    if (created.personalEventId) {
      await prisma.personalEvent.deleteMany({ where: { id: created.personalEventId } }).catch(() => {});
    }
    if (created.donationId) {
      await prisma.donation.deleteMany({ where: { id: created.donationId } }).catch(() => {});
    }
    if (created.uploadId) {
      await prisma.uploadAsset.deleteMany({ where: { id: created.uploadId } }).catch(() => {});
    }
    if (created.pastorCreatedUserId) {
      await prisma.notification.deleteMany({ where: { userId: created.pastorCreatedUserId } }).catch(() => {});
      await prisma.refreshToken.deleteMany({ where: { userId: created.pastorCreatedUserId } }).catch(() => {});
      await prisma.passwordResetToken.deleteMany({ where: { userId: created.pastorCreatedUserId } }).catch(() => {});
      await prisma.userRole.deleteMany({ where: { userId: created.pastorCreatedUserId } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: created.pastorCreatedUserId } }).catch(() => {});
    }
    if (created.memberUserId) {
      await prisma.notification.deleteMany({ where: { userId: created.memberUserId } }).catch(() => {});
      await prisma.refreshToken.deleteMany({ where: { userId: created.memberUserId } }).catch(() => {});
      await prisma.passwordResetToken.deleteMany({ where: { userId: created.memberUserId } }).catch(() => {});
      await prisma.userRole.deleteMany({ where: { userId: created.memberUserId } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: created.memberUserId } }).catch(() => {});
    }
    if (created.pastorCreatedMemberId) {
      await prisma.member.deleteMany({ where: { id: created.pastorCreatedMemberId } }).catch(() => {});
    }
    if (created.memberId) {
      await prisma.member.deleteMany({ where: { id: created.memberId } }).catch(() => {});
    }
    if (created.announcementId) {
      await prisma.announcement.deleteMany({ where: { id: created.announcementId } }).catch(() => {});
    }
    if (created.circularId) {
      await prisma.circular.deleteMany({ where: { id: created.circularId } }).catch(() => {});
    }
    if (created.eventId) {
      await prisma.event.deleteMany({ where: { id: created.eventId } }).catch(() => {});
    }
    if (created.assemblyId) {
      await prisma.assembly.deleteMany({ where: { id: created.assemblyId } }).catch(() => {});
    }
    if (created.districtId) {
      await prisma.district.deleteMany({ where: { id: created.districtId } }).catch(() => {});
    }

    await prisma.$disconnect();
  });

  describe('Multi-role and scope checks', () => {
    it('allows a regional leader to create a district only inside their region', async () => {
      const successResponse = await request(app)
        .post('/api/v1/districts')
        .set('Authorization', `Bearer ${tokens.regionalLeader}`)
        .send({
          name: `LOT3 District ${suffix}`,
          regionId: regionalLeaderRegionId,
        });

      expect(successResponse.status).toBe(201);
      created.districtId = successResponse.body.data.id;

      const forbiddenResponse = await request(app)
        .post('/api/v1/districts')
        .set('Authorization', `Bearer ${tokens.regionalLeader}`)
        .send({
          name: `LOT3 District Forbidden ${suffix}`,
          regionId: outsiderRegionId,
        });

      expect(forbiddenResponse.status).toBe(403);
    });

    it('allows a district leader to create an assembly only inside their district', async () => {
      const successResponse = await request(app)
        .post('/api/v1/assemblies')
        .set('Authorization', `Bearer ${tokens.districtLeader}`)
        .send({
          name: `LOT3 Assembly ${suffix}`,
          districtId: districtLeaderDistrictId,
        });

      expect(successResponse.status).toBe(201);
      created.assemblyId = successResponse.body.data.id;

      const forbiddenResponse = await request(app)
        .post('/api/v1/assemblies')
        .set('Authorization', `Bearer ${tokens.districtLeader}`)
        .send({
          name: `LOT3 Assembly Forbidden ${suffix}`,
          districtId: outsiderDistrictId,
        });

      expect(forbiddenResponse.status).toBe(403);
    });

    it('allows a pastor to create members inside their assembly and refuses outside', async () => {
      const successResponse = await request(app)
        .post('/api/v1/members')
        .set('Authorization', `Bearer ${tokens.pastor}`)
        .send({
          firstName: 'Local',
          lastName: `Member${suffix}`,
          gender: 'MALE',
          assemblyId: pastorAssemblyId,
          phone: '+237699000111',
        });

      expect(successResponse.status).toBe(201);
      created.pastorCreatedMemberId = successResponse.body.data.id;

      const forbiddenResponse = await request(app)
        .post('/api/v1/members')
        .set('Authorization', `Bearer ${tokens.pastor}`)
        .send({
          firstName: 'Outside',
          lastName: `Member${suffix}`,
          gender: 'MALE',
          assemblyId: outsiderAssemblyId,
          phone: '+237699000112',
        });

      expect(forbiddenResponse.status).toBe(403);
    });

    it('allows a pastor to create a local user and assign a local role only inside the assembly', async () => {
      const createUserResponse = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${tokens.pastor}`)
        .send({
          email: `lot3.local.admin.${suffix}@mpe-cameroun.org`,
          firstName: 'Local',
          lastName: 'Admin',
          password: 'LocalAdmin@2024',
          memberId: created.pastorCreatedMemberId,
        });

      expect(createUserResponse.status).toBe(201);
      created.pastorCreatedUserId = createUserResponse.body.data.id;

      const allowAssemblyRole = await request(app)
        .post(`/api/v1/users/${created.pastorCreatedUserId}/roles`)
        .set('Authorization', `Bearer ${tokens.pastor}`)
        .send({
          roleId: roleIds.assembly_admin,
          assemblyId: pastorAssemblyId,
        });

      expect(allowAssemblyRole.status).toBe(201);

      const denyDistrictRole = await request(app)
        .post(`/api/v1/users/${created.pastorCreatedUserId}/roles`)
        .set('Authorization', `Bearer ${tokens.pastor}`)
        .send({
          roleId: roleIds.district_leader,
          districtId: districtLeaderDistrictId,
        });

      expect(denyDistrictRole.status).toBe(403);
    });

    it('keeps ministry leaders and simple members out of local admin flows', async () => {
      const ministryLeaderResponse = await request(app)
        .post('/api/v1/members')
        .set('Authorization', `Bearer ${tokens.ministryLeader}`)
        .send({
          firstName: 'Denied',
          lastName: 'Ministry',
          gender: 'MALE',
          assemblyId: pastorAssemblyId,
        });

      expect(ministryLeaderResponse.status).toBe(403);

      const memberAdminListResponse = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${tokens.member}`);

      expect(memberAdminListResponse.status).toBe(403);

      const memberReadsAnnouncements = await request(app)
        .get('/api/v1/announcements')
        .set('Authorization', `Bearer ${tokens.member}`);

      expect(memberReadsAnnouncements.status).toBe(200);
    });
  });

  describe('Comments, calendar, donations, uploads and push', () => {
    beforeAll(async () => {
      const announcementResponse = await request(app)
        .post('/api/v1/announcements')
        .set('Authorization', `Bearer ${tokens.superAdmin}`)
        .send({
          title: `LOT3 Announcement ${suffix}`,
          content: 'Contenu national pour les tests lot 3 et la recette multi-profils.',
          level: 'NATIONAL',
        });

      expect(announcementResponse.status).toBe(201);
      created.announcementId = announcementResponse.body.data.id;

      const publishAnnouncementResponse = await request(app)
        .post(`/api/v1/announcements/${created.announcementId}/publish`)
        .set('Authorization', `Bearer ${tokens.superAdmin}`);

      expect(publishAnnouncementResponse.status).toBe(200);

      const circularResponse = await request(app)
        .post('/api/v1/circulars')
        .set('Authorization', `Bearer ${tokens.superAdmin}`)
        .send({
          title: `LOT3 Circular ${suffix}`,
          content: 'Circulaire nationale de test pour les commentaires et la visibilite.',
          level: 'NATIONAL',
        });

      expect(circularResponse.status).toBe(201);
      created.circularId = circularResponse.body.data.id;

      const publishCircularResponse = await request(app)
        .post(`/api/v1/circulars/${created.circularId}/publish`)
        .set('Authorization', `Bearer ${tokens.superAdmin}`);

      expect(publishCircularResponse.status).toBe(200);

      const eventResponse = await request(app)
        .post('/api/v1/events')
        .set('Authorization', `Bearer ${tokens.superAdmin}`)
        .send({
          title: `LOT3 Event ${suffix}`,
          description: 'Evenement national visible dans le calendrier hierarchique.',
          level: 'NATIONAL',
          startDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
          endDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString(),
          location: 'Yaounde',
        });

      expect(eventResponse.status).toBe(201);
      created.eventId = eventResponse.body.data.id;

      const publishEventResponse = await request(app)
        .post(`/api/v1/events/${created.eventId}/publish`)
        .set('Authorization', `Bearer ${tokens.superAdmin}`);

      expect(publishEventResponse.status).toBe(200);
    });

    it('allows scoped users to comment on published content', async () => {
      const announcementCommentResponse = await request(app)
        .post(`/api/v1/announcements/${created.announcementId}/comments`)
        .set('Authorization', `Bearer ${tokens.assemblyAdmin}`)
        .send({ content: `Commentaire annonce lot 3 ${suffix}` });

      expect(announcementCommentResponse.status).toBe(201);
      created.commentIds.push(announcementCommentResponse.body.data.id);

      const circularCommentResponse = await request(app)
        .post(`/api/v1/circulars/${created.circularId}/comments`)
        .set('Authorization', `Bearer ${tokens.member}`)
        .send({ content: `Commentaire circulaire lot 3 ${suffix}` });

      expect(circularCommentResponse.status).toBe(201);
      created.commentIds.push(circularCommentResponse.body.data.id);

      const commentsResponse = await request(app)
        .get(`/api/v1/announcements/${created.announcementId}/comments`)
        .set('Authorization', `Bearer ${tokens.member}`);

      expect(commentsResponse.status).toBe(200);
      expect(commentsResponse.body.data.length).toBeGreaterThan(0);
    });

    it('keeps personal calendar events private to their owner while exposing global feed', async () => {
      const createEventResponse = await request(app)
        .post('/api/v1/calendar/personal-events')
        .set('Authorization', `Bearer ${tokens.assemblyAdmin}`)
        .send({
          title: `LOT3 Personal Event ${suffix}`,
          description: 'Rendez-vous prive de test',
          startDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          endDate: new Date(Date.now() + 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(),
          location: 'Salle de reunion',
          notes: 'Ne doit pas sortir du scope personnel',
          isAllDay: false,
        });

      expect(createEventResponse.status).toBe(201);
      created.personalEventId = createEventResponse.body.data.id;

      const ownFeedResponse = await request(app)
        .get('/api/v1/calendar/feed')
        .set('Authorization', `Bearer ${tokens.assemblyAdmin}`);

      expect(ownFeedResponse.status).toBe(200);
      expect(
        ownFeedResponse.body.data.some(
          (entry: any) => entry.id === created.personalEventId && entry.source === 'personal',
        ),
      ).toBe(true);
      expect(
        ownFeedResponse.body.data.some(
          (entry: any) => entry.id === created.eventId && entry.source === 'global',
        ),
      ).toBe(true);

      const otherUserPersonalEventsResponse = await request(app)
        .get('/api/v1/calendar/personal-events')
        .set('Authorization', `Bearer ${tokens.ministryLeader}`);

      expect(otherUserPersonalEventsResponse.status).toBe(200);
      expect(
        otherUserPersonalEventsResponse.body.data.some((entry: any) => entry.id === created.personalEventId),
      ).toBe(false);
    });

    it('creates uploads and donation transactions with real server state and scope-aware reads', async () => {
      const uploadResponse = await request(app)
        .post('/api/v1/upload')
        .set('Authorization', `Bearer ${tokens.assemblyAdmin}`)
        .attach('file', Buffer.from('%PDF-1.4 lot3 receipt'), {
          filename: `lot3-receipt-${suffix}.pdf`,
          contentType: 'application/pdf',
        });

      expect(uploadResponse.status).toBe(201);
      created.uploadId = uploadResponse.body.data.id;

      const ownUploadsResponse = await request(app)
        .get('/api/v1/upload')
        .set('Authorization', `Bearer ${tokens.assemblyAdmin}`);

      expect(ownUploadsResponse.status).toBe(200);
      expect(ownUploadsResponse.body.data.some((asset: any) => asset.id === created.uploadId)).toBe(true);

      const foreignUploadsResponse = await request(app)
        .get('/api/v1/upload')
        .set('Authorization', `Bearer ${tokens.ministryLeader}`);

      expect(foreignUploadsResponse.status).toBe(200);
      expect(foreignUploadsResponse.body.data.some((asset: any) => asset.id === created.uploadId)).toBe(false);

      const donationResponse = await request(app)
        .post('/api/v1/donations')
        .set('Authorization', `Bearer ${tokens.districtLeader}`)
        .send({
          amount: 25000,
          currency: 'XAF',
          method: 'MOBILE_MONEY',
          purpose: 'Offrande speciale lot 3',
          notes: 'Transaction creee cote serveur pour la QA lot 3',
        });

      expect(donationResponse.status).toBe(201);
      expect(donationResponse.body.data.reference).toContain('DON-');
      expect(donationResponse.body.data.status).toBe('PENDING');
      created.donationId = donationResponse.body.data.id;

      const districtReadsDonationResponse = await request(app)
        .get(`/api/v1/donations/${created.donationId}`)
        .set('Authorization', `Bearer ${tokens.districtLeader}`);

      expect(districtReadsDonationResponse.status).toBe(200);

      const regionalDeniedDonationResponse = await request(app)
        .get(`/api/v1/donations/${created.donationId}`)
        .set('Authorization', `Bearer ${tokens.regionalLeader}`);

      expect(regionalDeniedDonationResponse.status).toBe(404);
    });

    it('persists push tokens and returns deep-link aware preview payloads', async () => {
      const pushTokenResponse = await request(app)
        .post('/api/v1/devices/push-tokens')
        .set('Authorization', `Bearer ${tokens.assemblyAdmin}`)
        .send({
          token: `ExponentPushToken[lot3-${suffix}]`,
          platform: 'ANDROID',
          provider: 'expo',
          appVersion: '1.0.0',
          deviceName: 'QA Device',
        });

      expect(pushTokenResponse.status).toBe(201);
      created.deviceTokenId = pushTokenResponse.body.data.id;

      const listTokensResponse = await request(app)
        .get('/api/v1/devices/push-tokens')
        .set('Authorization', `Bearer ${tokens.assemblyAdmin}`);

      expect(listTokensResponse.status).toBe(200);
      expect(listTokensResponse.body.data.some((token: any) => token.id === created.deviceTokenId)).toBe(true);

      const previewResponse = await request(app)
        .post('/api/v1/devices/push-preview')
        .set('Authorization', `Bearer ${tokens.superAdmin}`)
        .send({
          title: 'Don confirme',
          body: 'Votre transaction a ete validee.',
          entityType: 'Donation',
          entityId: created.donationId,
        });

      expect(previewResponse.status).toBe(200);
      expect(previewResponse.body.data.data.deepLink).toBe(`brethren://donations/${created.donationId}`);
      expect(previewResponse.body.data.data.screen).toBe('DonationDetail');
    });
  });
});
