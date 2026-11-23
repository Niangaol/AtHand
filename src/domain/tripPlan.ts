import type { PlannerEvent, Trip } from './planner.ts';
import { tripAllEvents, tripSelectedEvents } from './tripEvents.ts';

export { tripSelectedEvents };

export function tripBudgetCents(trip: Trip): number {
  return trip.budget.items.reduce((total, item) => total + item.amountCents, 0);
}

export function tripTodoProgress(trip: Trip): { done: number; total: number } {
  return { done: trip.todos.filter((todo) => todo.done).length, total: trip.todos.length };
}

export function tripDaysUntil(trip: Trip, today: string): number {
  return Math.round((Date.parse(`${trip.startDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400_000);
}

export function tripCountdown(trip: Trip, today: string): string {
  const days = tripDaysUntil(trip, today);
  if (days > 0) return `距出发 ${days} 天`;
  if (days === 0) return '今天出发';
  if (today <= trip.endDate) return `旅行中 · 第 ${1 - days} 天`;
  return `已结束 ${Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${trip.endDate}T00:00:00Z`)) / 86400_000)} 天`;
}

export function nextTrip(trips: readonly Trip[], today: string): Trip | null {
  return trips.filter((trip) => trip.endDate >= today).sort((left, right) => left.startDate.localeCompare(right.startDate) || left.id.localeCompare(right.id))[0] ?? null;
}

export function tripPlanEvents(trip: Trip, timeZone: string): PlannerEvent[] {
  return tripAllEvents(trip, timeZone);
}
