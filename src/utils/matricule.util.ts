import { prisma } from '../database/prisma';

export async function generateMatricule(assemblyCode?: string): Promise<string> {
  const year = new Date().getFullYear().toString().slice(-2);
  const prefix = assemblyCode ? assemblyCode.toUpperCase().slice(0, 3) : 'MPE';

  // Compte le nombre de membres existants pour générer un séquentiel unique
  const count = await prisma.member.count();
  const seq = String(count + 1).padStart(5, '0');

  return `${prefix}-${year}-${seq}`;
}

export async function generateCircularReference(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.circular.count({
    where: {
      createdAt: {
        gte: new Date(`${year}-01-01`),
        lt: new Date(`${year + 1}-01-01`),
      },
    },
  });
  const seq = String(count + 1).padStart(4, '0');
  return `CIRC-${year}-${seq}`;
}
