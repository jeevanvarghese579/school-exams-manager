import { describe, expect, it } from "vitest";
import {
  allRoomSeats,
  benchNumber,
  generateSeating,
  interleaveCandidates,
  physicalBenches,
  roomCapacity,
  roomSeats,
  snakeSeats,
  TEACHER_TABLE_LABEL,
} from "./seating";
import type { Candidate, Room, SeatingRules } from "../models";

const rules: SeatingRules = {
  avoidSubjectBench: true,
  avoidSubjectSide: true,
  avoidSubjectFrontBack: true,
  avoidClassBench: true,
  invigilatorsPerRoom: 1,
};
const makeRoom = (overrides: Partial<Room> = {}): Room => ({
  id: "r",
  name: "101",
  rows: 3,
  columns: 3,
  seatsPerBench: 2,
  teacherTablePosition: "front-center",
  disabled: [],
  active: true,
  ...overrides,
});
const candidate = (
  classId: string,
  roll: number,
  subject = classId,
): Candidate => ({
  id: `${classId}-${roll}`,
  roll: String(roll),
  classId,
  className: classId.toUpperCase(),
  subject,
});

describe("room geometry and snake traversal", () => {
  it("calculates rows × columns × seats per bench", () =>
    expect(
      roomCapacity(makeRoom({ rows: 4, columns: 5, seatsPerBench: 3 })),
    ).toBe(60));
  it("traverses row 1 left to right", () =>
    expect(
      snakeSeats([makeRoom()])
        .slice(0, 6)
        .map((seat) => seat.column),
    ).toEqual([0, 0, 1, 1, 2, 2]));
  it("traverses row 2 right to left", () =>
    expect(
      snakeSeats([makeRoom()])
        .slice(6, 12)
        .map((seat) => seat.column),
    ).toEqual([2, 2, 1, 1, 0, 0]));
  it("alternates back for subsequent rows", () =>
    expect(
      snakeSeats([makeRoom()])
        .slice(12, 18)
        .map((seat) => seat.column),
    ).toEqual([0, 0, 1, 1, 2, 2]));
  it("reverses individual seat positions inside every bench on even rows", () => {
    const room = makeRoom({ rows: 2, columns: 2, seatsPerBench: 4 });
    const order = snakeSeats([room]);
    expect(
      order.slice(0, 8).map((seat) => [seat.column, seat.position]),
    ).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 0],
      [1, 1],
      [1, 2],
      [1, 3],
    ]);
    expect(order.slice(8).map((seat) => [seat.column, seat.position])).toEqual([
      [1, 3],
      [1, 2],
      [1, 1],
      [1, 0],
      [0, 3],
      [0, 2],
      [0, 1],
      [0, 0],
    ]);
  });
  it("numbers benches in physical snake orientation", () => {
    const room = makeRoom();
    expect([0, 1, 2].map((column) => benchNumber(room, 0, column))).toEqual([
      1, 2, 3,
    ]);
    expect([0, 1, 2].map((column) => benchNumber(room, 1, column))).toEqual([
      6, 5, 4,
    ]);
  });
  it("keeps disabled seats out of allocation without removing them from the diagram", () => {
    const room = makeRoom({ rows: 1, columns: 1, disabled: ["r:0:0:1"] });
    expect(allRoomSeats([room])).toHaveLength(2);
    expect(roomSeats([room]).map((seat) => seat.id)).toEqual(["r:0:0:0"]);
  });
  it("provides every physical bench and the teacher table for screen/print diagrams", () => {
    const room = makeRoom({ rows: 4, columns: 5 });
    expect(physicalBenches(room)).toHaveLength(20);
    expect(TEACHER_TABLE_LABEL).toBe("TEACHER'S TABLE");
  });
});

describe("candidate mixing", () => {
  it("round-robins three classes", () => {
    const people = ["s", "c", "h"].flatMap((classId) =>
      [1, 2, 3].map((roll) => candidate(classId, roll)),
    );
    expect(interleaveCandidates(people, 4).map((item) => item.id)).toEqual([
      "s-1",
      "c-1",
      "h-1",
      "s-2",
      "c-2",
      "h-2",
      "s-3",
      "c-3",
      "h-3",
    ]);
  });
  it("continues when unequal classes become exhausted", () => {
    const people = [
      candidate("a", 1),
      candidate("b", 1),
      candidate("b", 2),
      candidate("b", 3),
      candidate("c", 1),
      candidate("c", 2),
    ];
    const output = interleaveCandidates(people, 3);
    expect(output.map((item) => item.id)).toEqual([
      "a-1",
      "b-1",
      "c-1",
      "b-2",
      "c-2",
      "b-3",
    ]);
    expect(new Set(output.map((item) => item.id)).size).toBe(6);
  });
  it.each([2, 3, 4])(
    "allocates uniquely with %i students per bench",
    (seatsPerBench) => {
      const room = makeRoom({ rows: 2, columns: 2, seatsPerBench });
      const people = Array.from({ length: 4 * seatsPerBench }, (_, index) =>
        candidate(String(index % 4), Math.floor(index / 4) + 1),
      );
      const plan = generateSeating(people, [room], rules);
      expect(plan.assignments).toHaveLength(people.length);
      expect(
        new Set(plan.assignments.map((item) => item.candidateId)).size,
      ).toBe(people.length);
      expect(new Set(plan.assignments.map((item) => item.seatId)).size).toBe(
        people.length,
      );
    },
  );
  it("assigns the stream to physical rows left, right, then left again", () => {
    const room = makeRoom({ rows: 3, columns: 2, seatsPerBench: 2 });
    const people = Array.from({ length: 12 }, (_, index) =>
      candidate(index % 2 ? "c" : "s", Math.floor(index / 2) + 1),
    );
    const plan = generateSeating(people, [room], {
      ...rules,
      avoidSubjectBench: false,
      avoidSubjectSide: false,
      avoidSubjectFrontBack: false,
      avoidClassBench: false,
    });
    const occupant = (row: number, column: number, position: number) =>
      plan.assignments.find(
        (item) => item.seatId === `r:${row}:${column}:${position}`,
      )?.candidateId;
    expect(
      [0, 1].flatMap((column) =>
        [0, 1].map((position) => occupant(0, column, position)),
      ),
    ).toEqual(["s-1", "c-1", "s-2", "c-2"]);
    expect(
      [1, 0].flatMap((column) =>
        [1, 0].map((position) => occupant(1, column, position)),
      ),
    ).toEqual(["s-3", "c-3", "s-4", "c-4"]);
    expect(
      [0, 1].flatMap((column) =>
        [0, 1].map((position) => occupant(2, column, position)),
      ),
    ).toEqual(["s-5", "c-5", "s-6", "c-6"]);
  });
  it("separates second-language papers within benches when possible", () => {
    const room = makeRoom({ rows: 1, columns: 2, seatsPerBench: 2 });
    const people = [
      candidate("a", 1, "Hindi"),
      candidate("b", 1, "Hindi"),
      candidate("c", 1, "Malayalam"),
      candidate("d", 1, "Malayalam"),
    ].map((item) => ({ ...item, language: item.subject }));
    const plan = generateSeating(people, [room], rules);
    expect(
      plan.conflicts.filter((item) => item.includes("same bench")),
    ).toHaveLength(0);
  });
  it("keeps locked assignments and protected empty seats during regeneration", () => {
    const room = makeRoom({ rows: 1, columns: 2, seatsPerBench: 2 });
    const people = [candidate("a", 1), candidate("b", 1)];
    const locked = [{ seatId: "r:0:0:0", candidateId: "a-1", locked: true }];
    const plan = generateSeating(people, [room], rules, 2, locked, ["r:0:0:1"]);
    expect(plan.assignments).toContainEqual(locked[0]);
    expect(plan.assignments.some((item) => item.seatId === "r:0:0:1")).toBe(
      false,
    );
  });
  it("fails only when hard capacity is insufficient", () => {
    const room = makeRoom({ rows: 1, columns: 1, seatsPerBench: 2 });
    expect(() =>
      generateSeating(
        [candidate("a", 1), candidate("b", 1), candidate("c", 1)],
        [room],
        rules,
      ),
    ).toThrow("cannot be seated");
  });
});
