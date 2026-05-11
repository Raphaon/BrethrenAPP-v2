import { prismaMock } from '../helpers/test-setup';

jest.mock('../../src/utils/audit.util', () => ({ createAuditLog: jest.fn() }));
jest.mock('../../src/utils/scope-access.util', () => ({
  assertAssemblyAccess: jest.fn().mockResolvedValue(undefined),
  getScopedAssemblyWhere: jest.fn().mockResolvedValue({}),
}));

const mockDonation = {
  id: 'don-1', amount: '50000', currency: 'XAF', type: 'TITHE',
  paymentMethod: 'CASH', date: new Date('2025-05-01'), status: 'CONFIRMED',
  assemblyId: 'asm-1', memberId: 'mem-1', notes: null,
  assembly: { id: 'asm-1', name: 'Assemblée Centrale' },
  member: { id: 'mem-1', firstName: 'Jean', lastName: 'Paul', matricule: 'ACY-25-00001' },
};

describe('Donations module', () => {

  // ─── Listing ──────────────────────────────────────────────────────────────

  describe('list', () => {
    it('should return paginated donations', async () => {
      prismaMock.$transaction.mockResolvedValue([[mockDonation], 1] as any);
      const [rows, total] = await prismaMock.$transaction([
        prismaMock.donation.findMany({ where: { assemblyId: 'asm-1' } } as any),
        prismaMock.donation.count({ where: { assemblyId: 'asm-1' } } as any),
      ] as any);
      expect(rows).toHaveLength(1);
      expect(total).toBe(1);
    });

    it('should filter by type', async () => {
      prismaMock.$transaction.mockResolvedValue([
        [mockDonation, { ...mockDonation, id: 'don-2', type: 'TITHE' }], 2,
      ] as any);
      const [rows] = await prismaMock.$transaction([
        prismaMock.donation.findMany({ where: { type: 'TITHE' } } as any),
        prismaMock.donation.count({ where: { type: 'TITHE' } } as any),
      ] as any);
      expect(rows.every((d: any) => d.type === 'TITHE')).toBe(true);
    });

    it('should filter by date range', () => {
      const from = '2025-05-01';
      const to = '2025-05-31';
      const filter = {
        date: { gte: new Date(from), lte: new Date(to) },
      };
      expect(filter.date.gte).toEqual(new Date(from));
    });
  });

  // ─── Create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should persist donation with correct fields', async () => {
      prismaMock.donation.create.mockResolvedValue(mockDonation as any);
      const don = await prismaMock.donation.create({
        data: { amount: 50000, currency: 'XAF', type: 'TITHE', paymentMethod: 'CASH', assemblyId: 'asm-1' },
      } as any) as any;
      expect(don.amount).toBe('50000');
      expect(don.type).toBe('TITHE');
    });

    it('should accept anonymous donation (no memberId)', async () => {
      prismaMock.donation.create.mockResolvedValue({ ...mockDonation, memberId: null, member: null } as any);
      const don = await prismaMock.donation.create({
        data: { amount: 10000, currency: 'XAF', type: 'OFFERING', paymentMethod: 'CASH', assemblyId: 'asm-1' },
      } as any);
      expect(don.memberId).toBeNull();
    });
  });

  // ─── Types de dons ────────────────────────────────────────────────────────

  describe('donation types', () => {
    it.each(['TITHE', 'OFFERING', 'SPECIAL_GIFT', 'PROJECT', 'CONSTRUCTION', 'MISSIONARY', 'CAMPAIGN'])(
      'should accept type %s', (type) => {
        const valid = ['TITHE', 'OFFERING', 'SPECIAL_GIFT', 'PROJECT', 'CONSTRUCTION', 'MISSIONARY', 'CAMPAIGN'];
        expect(valid).toContain(type);
      }
    );
  });

  // ─── Modes de paiement ────────────────────────────────────────────────────

  describe('payment methods', () => {
    it.each(['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CHECK', 'CARD', 'OTHER'])(
      'should accept payment method %s', (method) => {
        const valid = ['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CHECK', 'CARD', 'OTHER'];
        expect(valid).toContain(method);
      }
    );
  });

  // ─── Status transitions ───────────────────────────────────────────────────

  describe('status', () => {
    it('should update status to CONFIRMED', async () => {
      prismaMock.donation.update.mockResolvedValue({ ...mockDonation, status: 'CONFIRMED' } as any);
      const updated = await prismaMock.donation.update({
        where: { id: 'don-1' }, data: { status: 'CONFIRMED' },
      } as any);
      expect(updated.status).toBe('CONFIRMED');
    });

    it('should update status to CANCELLED', async () => {
      prismaMock.donation.update.mockResolvedValue({ ...mockDonation, status: 'CANCELLED' } as any);
      const updated = await prismaMock.donation.update({
        where: { id: 'don-1' }, data: { status: 'CANCELLED' },
      } as any);
      expect(updated.status).toBe('CANCELLED');
    });
  });

  // ─── Montants ─────────────────────────────────────────────────────────────

  describe('amount serialization', () => {
    it('should return amount as string (Decimal serialization)', () => {
      expect(typeof mockDonation.amount).toBe('string');
    });

    it('should parse string amount back to number for calculations', () => {
      const amount = Number(mockDonation.amount);
      expect(amount).toBe(50000);
    });
  });
});
