import type {
  DutyAssignment,
  DutyRosterAssignment,
  Teacher,
} from "../models";

export type FlexibleDutyMode = "half" | "absolute-equal";

export interface DutyHall {
  date: string;
  session: string;
  roomId: string;
}

export interface DutySegment {
  hallIndex: number;
  slot: number;
  share: number;
}

function halfDutyUnits(hallCount: number, teacherCount: number): number[] {
  if (teacherCount < 1) return [];
  const totalUnits = hallCount * 2;
  const baseUnits = Math.floor(totalUnits / teacherCount);
  const extraUnits = totalUnits % teacherCount;
  return Array.from(
    { length: teacherCount },
    (_, index) => baseUnits + Number(index < extraUnits),
  );
}

export function absoluteDutyDivisions(
  hallDutyCount: number,
  teacherCount: number,
): number {
  if (hallDutyCount < 1 || teacherCount < 1) return 1;
  let a = hallDutyCount;
  let b = teacherCount;
  while (b) [a, b] = [b, a % b];
  return teacherCount / a;
}

export function createDutySegments(
  hallCount: number,
  teacherCount: number,
  mode: FlexibleDutyMode,
): DutySegment[] {
  if (hallCount < 1) return [];
  if (teacherCount < 1)
    return Array.from({ length: hallCount }, (_, hallIndex) => ({
      hallIndex,
      slot: 1,
      share: 1,
    }));

  const units = halfDutyUnits(hallCount, teacherCount);
  const splitHallCount =
    mode === "half"
      ? units.filter((unitCount) => unitCount % 2 === 1).length / 2
      : hallCount - Math.floor(hallCount / teacherCount) * teacherCount;
  const fullHallCount = hallCount - splitHallCount;
  const splitHallIndexes = new Set<number>();
  for (let index = 0; index < splitHallCount; index += 1) {
    splitHallIndexes.add(
      Math.min(
        hallCount - 1,
        Math.floor(((index + 0.5) * hallCount) / splitHallCount),
      ),
    );
  }
  const segments: DutySegment[] = Array.from(
    { length: hallCount },
    (_, hallIndex) =>
      splitHallIndexes.has(hallIndex)
        ? []
        : [{ hallIndex, slot: 1, share: 1 }],
  ).flat();

  if (mode === "half") {
    for (const hallIndex of [...splitHallIndexes].sort((a, b) => a - b)) {
      segments.push(
        { hallIndex, slot: 1, share: 0.5 },
        { hallIndex, slot: 2, share: 0.5 },
      );
    }
    return segments.sort(
      (a, b) => a.hallIndex - b.hallIndex || a.slot - b.slot,
    );
  }

  // Absolute equality starts with an equal number of whole duties per teacher.
  segments.splice(
    0,
    segments.length,
    ...Array.from(
      { length: fullHallCount },
      (_, hallIndex) => ({ hallIndex, slot: 1, share: 1 }),
    ),
  );

  const remainingHallCount = hallCount - fullHallCount;
  if (!remainingHallCount) return segments;
  const teacherShare = remainingHallCount / teacherCount;
  let teacherIndex = 0;
  let teacherRemaining = teacherShare;
  const epsilon = 1e-9;
  for (let hallIndex = fullHallCount; hallIndex < hallCount; hallIndex += 1) {
    let hallRemaining = 1;
    let slot = 1;
    while (hallRemaining > epsilon) {
      const share = Math.min(hallRemaining, teacherRemaining);
      segments.push({ hallIndex, slot, share });
      hallRemaining -= share;
      teacherRemaining -= share;
      slot += 1;
      if (teacherRemaining <= epsilon) {
        teacherIndex += 1;
        teacherRemaining = teacherIndex < teacherCount ? teacherShare : 0;
      }
    }
  }
  return segments;
}

export function allocateFlexibleDuties(
  halls: DutyHall[],
  teacherIds: string[],
  mode: FlexibleDutyMode,
): DutyRosterAssignment[] {
  if (!teacherIds.length) return [];
  const segments = createDutySegments(halls.length, teacherIds.length, mode);
  if (mode === "half") {
    const units = halfDutyUnits(halls.length, teacherIds.length);
    const remaining = new Map(
      teacherIds.map((teacherId, index) => [
        teacherId,
        { full: Math.floor(units[index] / 2), half: units[index] % 2 },
      ]),
    );
    const result: DutyRosterAssignment[] = [];
    const dayNumber = (date: string) =>
      Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 86_400_000);
    for (const segment of segments) {
      const hall = halls[segment.hallIndex];
      const quotaKey = segment.share === 1 ? "full" : "half";
      const teacherId = teacherIds
        .filter((id) => (remaining.get(id)?.[quotaKey] ?? 0) > 0)
        .sort((a, b) => {
          const score = (id: string) => {
            const previous = result.filter((item) => item.teacherId === id);
            const concurrent = previous.some(
              (item) =>
                item.date === hall.date && item.session === hall.session,
            );
            const bothSessions = previous.some(
              (item) => item.date === hall.date && item.session !== hall.session,
            );
            const consecutive = previous.some(
              (item) =>
                Math.abs(dayNumber(item.date) - dayNumber(hall.date)) === 1,
            );
            const sameRoom = previous.some(
              (item) => item.roomId === hall.roomId,
            );
            const sameSessionCount = previous.filter(
              (item) => item.session === hall.session,
            ).length;
            return (
              Number(concurrent) * 1_000_000 +
              Number(bothSessions) * 100_000 +
              Number(consecutive) * 10_000 +
              Number(sameRoom) * 1_000 +
              sameSessionCount * 10 +
              previous.length
            );
          };
          return score(a) - score(b) || a.localeCompare(b);
        })[0];
      if (!teacherId) continue;
      remaining.get(teacherId)![quotaKey] -= 1;
      result.push({
        date: hall.date,
        session: hall.session,
        roomId: hall.roomId,
        slot: segment.slot,
        share: segment.share,
        teacherId,
      });
    }
    return result;
  }
  const fullHallCount = Math.floor(halls.length / teacherIds.length) * teacherIds.length;
  let residualTeacherIndex = 0;
  let residualAssigned = 0;
  const residualTarget =
    mode === "absolute-equal"
      ? (halls.length - fullHallCount) / teacherIds.length
      : 0;
  const epsilon = 1e-9;

  return segments.map((segment) => {
    let teacherId: string;
    if (segment.hallIndex < fullHallCount) {
      teacherId = teacherIds[segment.hallIndex % teacherIds.length];
    } else {
      teacherId = teacherIds[residualTeacherIndex];
      residualAssigned += segment.share;
      if (residualAssigned >= residualTarget - epsilon) {
        residualTeacherIndex = Math.min(
          residualTeacherIndex + 1,
          teacherIds.length - 1,
        );
        residualAssigned = 0;
      }
    }
    const hall = halls[segment.hallIndex];
    return {
      date: hall.date,
      session: hall.session,
      roomId: hall.roomId,
      slot: segment.slot,
      share: segment.share,
      teacherId,
    };
  });
}

export function allocateDuties(roomIds:string[], teachers:Teacher[], key:string, count=1, locked:DutyAssignment[]=[]):DutyAssignment[]{const out=[...locked], used=new Set(locked.map(x=>x.teacherId)); for(const roomId of roomIds)for(let n=0;n<count;n++){if(locked.some(x=>x.roomId===roomId))continue;const choices=teachers.filter(t=>!t.unavailable.includes(key)&&!used.has(t.id)&&(t.maxDuties===undefined||out.filter(x=>x.teacherId===t.id).length<t.maxDuties)).sort((a,b)=>out.filter(x=>x.teacherId===a.id).length-out.filter(x=>x.teacherId===b.id).length);if(choices[0]){out.push({roomId,teacherId:choices[0].id});used.add(choices[0].id);}}return out;}
