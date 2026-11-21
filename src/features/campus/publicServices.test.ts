import { expect, it } from 'vitest';
import { publicServices } from './publicServices';
import { serviceSchema } from '../../domain/planner';

it('ships ten explicitly sourced public paths rather than fictional school policies', () => {
  expect(publicServices).toHaveLength(10);
  expect(new Set(publicServices.map((e) => e.id)).size).toBe(10);
  for (const entry of publicServices) {
    expect(serviceSchema.safeParse(entry).success).toBe(true);
    expect(new URL(entry.sourceUrl).hostname).toMatch(/(^|\.)hdu\.edu\.cn$/);
    expect(entry.verifiedAt).toBe('2026-11-21');
    expect(entry.steps.length).toBeGreaterThan(10);
  }
  expect(publicServices.find((v) => v.id === 'public:insurance')?.steps).toContain('2026级');
});
