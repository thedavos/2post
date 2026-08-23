import type { PrismaService } from "../../prisma/prisma.service";
import type { DayOfWeek } from "../../../generated/prisma";

const DAY_ORDER: readonly DayOfWeek[] = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];

function dayIndex(day: DayOfWeek): number {
  return DAY_ORDER.indexOf(day);
}

/// Next datetime for a weekly slot strictly after `from` (UTC-based; the
/// workspace-timezone refinement lands with the calendar UI phase).
export function nextSlotDatetime(
  slot: { dayOfWeek: DayOfWeek; time: string },
  from: Date,
): Date {
  const [hours, minutes] = slot.time.split(":").map(Number);
  const candidate = new Date(from);
  const targetDay = dayIndex(slot.dayOfWeek);
  // JS getDay(): 0 = Sunday. Our order: 0 = Monday.
  const currentDay = (candidate.getUTCDay() + 6) % 7;
  let daysAhead = targetDay - currentDay;

  candidate.setUTCHours(hours!, minutes!, 0, 0);
  if (daysAhead < 0 || (daysAhead === 0 && candidate.getTime() <= from.getTime())) {
    daysAhead += 7;
  }
  candidate.setUTCDate(candidate.getUTCDate() + daysAhead);
  return candidate;
}

/**
 * Auto-assign the next free recurring-slot datetime for a queue entry.
 * Parity with legacy calendar queue behavior: entries take slots in
 * insertion order, skipping datetimes already taken within the same queue.
 */
export async function assignNextSlotDatetime(
  prisma: PrismaService,
  queue: {
    id: string;
    accountId: string | null;
    workspaceId: string;
  },
  from: Date = new Date(),
): Promise<Date> {
  const slots = await prisma.postingSlot.findMany({
    where: {
      isActive: true,
      ...(queue.accountId ? { socialAccountId: queue.accountId } : {}),
      socialAccount: { workspaceId: queue.workspaceId },
    },
    select: { dayOfWeek: true, time: true },
  });

  if (slots.length === 0) {
    throw new Error("Queue has no active posting slots to assign");
  }

  const taken = new Set(
    (
      await prisma.queueEntry.findMany({
        where: { queueId: queue.id, assignedSlotDatetime: { not: null } },
        select: { assignedSlotDatetime: true },
      })
    ).map((e) => e.assignedSlotDatetime!.toISOString()),
  );

  // Look ahead up to 8 weeks across all slot occurrences.
  const horizon = new Date(from.getTime() + 8 * 7 * 24 * 60 * 60 * 1000);
  const occurrences: Date[] = [];
  for (const slot of slots) {
    let cursor = nextSlotDatetime(slot, from);
    while (cursor <= horizon) {
      occurrences.push(cursor);
      cursor = nextSlotDatetime(slot, new Date(cursor.getTime() + 1000));
    }
  }
  occurrences.sort((a, b) => a.getTime() - b.getTime());

  for (const occurrence of occurrences) {
    if (!taken.has(occurrence.toISOString())) return occurrence;
  }

  throw new Error("No free slot available within the assignment horizon");
}
