import type { ServiceEntry } from './planner';

export function findServices(entries: ServiceEntry[], query: string, category: string): ServiceEntry[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => (category === '全部' || entry.category === category) && words.every((word) => `${entry.title} ${entry.category} ${entry.entry} ${entry.steps}`.toLocaleLowerCase().includes(word)));
}

export function serviceEvidence(entry: ServiceEntry, today: string) {
  const age = entry.verifiedAt ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${entry.verifiedAt}T00:00:00Z`)) / 86400_000) : null;
  return { sourced: Boolean(entry.sourceUrl), stale: age !== null && age > 30,
    availability: entry.hours.trim() ? `公布的办理时间：${entry.hours}；当天是否开放请向办理方确认。` : '能否现在办理未确认' };
}
