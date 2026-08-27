import type {
  Candidate,
  Room,
  Seat,
  SeatAssignment,
  SeatingPlan,
  SeatingRules,
} from "../models";

export const seatId = (
  roomId: string,
  row: number,
  column: number,
  position: number,
) => `${roomId}:${row}:${column}:${position}`;
export const benchId = (seat: Pick<Seat, "roomId" | "row" | "column">) =>
  `${seat.roomId}:${seat.row}:${seat.column}`;
export const roomCapacity = (room: Room) =>
  room.rows * room.columns * room.seatsPerBench;
export const TEACHER_TABLE_LABEL = "TEACHER'S TABLE";
export const physicalBenches = (room: Room) =>
  Array.from({ length: room.rows * room.columns }, (_, index) => ({
    row: Math.floor(index / room.columns),
    column: index % room.columns,
  }));

export const allRoomSeats = (rooms: Room[]): Seat[] =>
  rooms
    .filter((room) => room.active)
    .flatMap((room) =>
      Array.from(
        { length: room.rows * room.columns * room.seatsPerBench },
        (_, index) => {
          const bench = Math.floor(index / room.seatsPerBench);
          return {
            id: seatId(
              room.id,
              Math.floor(bench / room.columns),
              bench % room.columns,
              index % room.seatsPerBench,
            ),
            roomId: room.id,
            row: Math.floor(bench / room.columns),
            column: bench % room.columns,
            position: index % room.seatsPerBench,
          };
        },
      ),
    );

export const roomSeats = (rooms: Room[]): Seat[] => {
  const disabled = new Set(rooms.flatMap((room) => room.disabled ?? []));
  return allRoomSeats(rooms).filter((seat) => !disabled.has(seat.id));
};

/** Seats in allocation order: odd display rows L→R, even display rows R→L. */
export const snakeSeats = (rooms: Room[]): Seat[] => {
  const enabled = new Set(roomSeats(rooms).map((seat) => seat.id));
  return rooms
    .filter((room) => room.active)
    .flatMap((room) => {
      const result: Seat[] = [];
      for (let row = 0; row < room.rows; row++) {
        const columns = Array.from(
          { length: room.columns },
          (_, column) => column,
        );
        if (row % 2 === 1) columns.reverse();
        const positions = Array.from(
          { length: room.seatsPerBench },
          (_, position) => position,
        );
        if (row % 2 === 1) positions.reverse();
        for (const column of columns)
          for (const position of positions) {
            const seat: Seat = {
              id: seatId(room.id, row, column, position),
              roomId: room.id,
              row,
              column,
              position,
            };
            if (enabled.has(seat.id)) result.push(seat);
          }
      }
      return result;
    });
};

export const benchNumber = (room: Room, row: number, column: number) =>
  row * room.columns + (row % 2 === 0 ? column + 1 : room.columns - column);

const rollCompare = (a: Candidate, b: Candidate) =>
  a.roll.localeCompare(b.roll, undefined, { numeric: true });

/** Round-robin classes, preferring a different paper within the current bench. */
export function interleaveCandidates(
  candidates: Candidate[],
  seatsPerBench: number,
): Candidate[] {
  const classOrder = [
    ...new Set(candidates.map((candidate) => candidate.classId)),
  ];
  const queues = new Map(
    classOrder.map((classId) => [
      classId,
      candidates
        .filter((candidate) => candidate.classId === classId)
        .sort(rollCompare),
    ]),
  );
  const result: Candidate[] = [];
  let cursor = 0;
  while (result.length < candidates.length) {
    const papersOnBench = new Set(
      result
        .slice(Math.floor(result.length / seatsPerBench) * seatsPerBench)
        .map((candidate) => candidate.subject),
    );
    const choices = classOrder
      .map((classId) => ({
        classId,
        offset:
          (classOrder.indexOf(classId) - cursor + classOrder.length) %
          classOrder.length,
        candidate: queues.get(classId)?.[0],
      }))
      .filter((choice) => choice.candidate);
    if (!choices.length) break;
    choices.sort(
      (a, b) =>
        Number(papersOnBench.has(a.candidate!.subject)) -
          Number(papersOnBench.has(b.candidate!.subject)) ||
        a.offset - b.offset,
    );
    const chosen = choices[0];
    result.push(queues.get(chosen.classId)!.shift()!);
    cursor = (classOrder.indexOf(chosen.classId) + 1) % classOrder.length;
  }
  return result;
}

const adjacent = (a: Seat, b: Seat) =>
  a.roomId === b.roomId &&
  ((a.row === b.row && a.column === b.column) ||
    (a.row === b.row && Math.abs(a.column - b.column) === 1) ||
    (a.column === b.column && Math.abs(a.row - b.row) === 1));

export function validateSeating(
  assignments: SeatAssignment[],
  candidates: Candidate[],
  seats: Seat[],
  rules?: SeatingRules,
): string[] {
  const messages: string[] = [];
  const candidateSeen = new Set<string>();
  const seatSeen = new Set<string>();
  for (const assignment of assignments) {
    if (candidateSeen.has(assignment.candidateId))
      messages.push(`Duplicate candidate ${assignment.candidateId}`);
    if (seatSeen.has(assignment.seatId))
      messages.push(`Duplicate seat ${assignment.seatId}`);
    candidateSeen.add(assignment.candidateId);
    seatSeen.add(assignment.seatId);
  }
  for (let i = 0; i < assignments.length; i++)
    for (let j = i + 1; j < assignments.length; j++) {
      const first = candidates.find(
        (candidate) => candidate.id === assignments[i].candidateId,
      );
      const second = candidates.find(
        (candidate) => candidate.id === assignments[j].candidateId,
      );
      const a = seats.find((seat) => seat.id === assignments[i].seatId);
      const b = seats.find((seat) => seat.id === assignments[j].seatId);
      if (
        !first ||
        !second ||
        !a ||
        !b ||
        first.subject !== second.subject ||
        !adjacent(a, b)
      )
        continue;
      const label = first.language
        ? `Language ${first.subject}`
        : first.subject;
      if (
        a.row === b.row &&
        a.column === b.column &&
        (rules?.avoidSubjectBench ?? true)
      )
        messages.push(`${label}: same bench (${a.roomId}, row ${a.row + 1})`);
      else if (a.row === b.row && rules?.avoidSubjectSide)
        messages.push(
          `${label}: side-by-side benches (${a.roomId}, row ${a.row + 1})`,
        );
      else if (a.column === b.column && rules?.avoidSubjectFrontBack)
        messages.push(
          `${label}: front/back benches (${a.roomId}, column ${a.column + 1})`,
        );
    }
  return messages;
}

export function generateSeating(
  candidates: Candidate[],
  rooms: Room[],
  rules: SeatingRules,
  seed = 1,
  locked: SeatAssignment[] = [],
  protectedSeatIds: string[] = [],
): SeatingPlan {
  const seats = snakeSeats(rooms);
  const seatSet = new Set(seats.map((seat) => seat.id));
  const validLocked = locked.filter(
    (assignment) =>
      seatSet.has(assignment.seatId) &&
      candidates.some((candidate) => candidate.id === assignment.candidateId),
  );
  const lockedCandidates = new Set(
    validLocked.map((assignment) => assignment.candidateId),
  );
  const unavailableSeats = new Set([
    ...validLocked.map((assignment) => assignment.seatId),
    ...protectedSeatIds,
  ]);
  const available = seats.filter((seat) => !unavailableSeats.has(seat.id));
  const remaining = candidates.filter(
    (candidate) => !lockedCandidates.has(candidate.id),
  );
  if (remaining.length > available.length)
    throw new Error(
      `${candidates.length} candidates cannot be seated: only ${seats.length - protectedSeatIds.length} seats available.`,
    );

  const assignments = [...validLocked];
  const classOrder = [
    ...new Set(remaining.map((candidate) => candidate.classId)),
  ];
  const queues = new Map(
    classOrder.map((classId) => [
      classId,
      remaining
        .filter((candidate) => candidate.classId === classId)
        .sort(rollCompare),
    ]),
  );
  let cursor = 0;
  for (const seat of available) {
    const choices = classOrder
      .map((classId) => ({
        classId,
        candidate: queues.get(classId)?.[0],
        offset:
          (classOrder.indexOf(classId) - cursor + classOrder.length) %
          classOrder.length,
      }))
      .filter((choice) => choice.candidate);
    if (!choices.length) break;
    choices.sort((a, b) => {
      const penalty = (candidate: Candidate) =>
        assignments.reduce((total, assignment) => {
          const other = candidates.find(
            (item) => item.id === assignment.candidateId,
          );
          const otherSeat = seats.find((item) => item.id === assignment.seatId);
          if (!other || !otherSeat || !adjacent(seat, otherSeat)) return total;
          if (candidate.subject === other.subject) {
            if (
              seat.row === otherSeat.row &&
              seat.column === otherSeat.column &&
              rules.avoidSubjectBench
            )
              total += 100;
            else if (seat.row === otherSeat.row && rules.avoidSubjectSide)
              total += 30;
            else if (
              seat.column === otherSeat.column &&
              rules.avoidSubjectFrontBack
            )
              total += 10;
          }
          if (
            candidate.classId === other.classId &&
            seat.row === otherSeat.row &&
            seat.column === otherSeat.column &&
            rules.avoidClassBench
          )
            total += 8;
          return total;
        }, 0);
      return (
        penalty(a.candidate!) - penalty(b.candidate!) || a.offset - b.offset
      );
    });
    const chosen = choices[0];
    const candidate = queues.get(chosen.classId)!.shift()!;
    assignments.push({ seatId: seat.id, candidateId: candidate.id });
    cursor = (classOrder.indexOf(chosen.classId) + 1) % classOrder.length;
  }
  const conflicts = validateSeating(assignments, candidates, seats, rules);
  return {
    id: crypto.randomUUID(),
    date: "",
    session: "",
    seed,
    assignments,
    score: conflicts.length,
    conflicts,
    generatedAt: Date.now(),
    lockedSeatIds: protectedSeatIds,
  };
}
