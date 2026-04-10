import { db, TypologyPrice, generateId } from './database';

export async function getTypologyPrices(projectId: string): Promise<TypologyPrice[]> {
  return db.typologyPrices.where('projectId').equals(projectId).toArray();
}

export async function upsertTypologyPrice(
  projectId: string,
  attraversamento: string,
  pricePerUnit: number,
  unit: 'piece' | 'sqm'
): Promise<void> {
  const existing = await db.typologyPrices
    .where('[projectId+attraversamento]')
    .equals([projectId, attraversamento])
    .first();

  if (existing) {
    await db.typologyPrices.update(existing.id, { pricePerUnit, unit });
  } else {
    await db.typologyPrices.add({
      id: generateId(),
      projectId,
      attraversamento,
      pricePerUnit,
      unit,
    });
  }
}

export async function deleteTypologyPrice(id: string): Promise<void> {
  await db.typologyPrices.delete(id);
}
