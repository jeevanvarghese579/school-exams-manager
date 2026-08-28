import { expect, it } from "vitest";
import {
  absoluteDutyDivisions,
  allocateDuties,
  allocateFlexibleDuties,
  createDutySegments,
} from "./duties";

it("honours unavailable teachers and distributes duties", () => {
  const result = allocateDuties(
    ["a", "b"],
    [
      { id: "x", name: "X", unavailable: ["d"] },
      { id: "y", name: "Y", unavailable: [] },
    ],
    "d",
  );
  expect(result).toHaveLength(1);
  expect(result[0].teacherId).toBe("y");
});

it("uses the smallest hall split that produces absolutely equal duties", () => {
  expect(absoluteDutyDivisions(20, 15)).toBe(3);
  expect(absoluteDutyDivisions(12, 6)).toBe(1);
  expect(absoluteDutyDivisions(16, 15)).toBe(15);
  expect(absoluteDutyDivisions(0, 15)).toBe(1);
});

it("keeps full duties and halves only the remainder in half-duty mode", () => {
  const segments = createDutySegments(8, 6, "half");
  expect(segments.filter((segment) => segment.share === 1)).toHaveLength(6);
  expect(segments.filter((segment) => segment.share === 0.5)).toHaveLength(4);
});

it("pairs half units into full duties to minimize each teacher's duty days", () => {
  const halls = Array.from({ length: 29 }, (_, index) => ({
    date: `2026-09-${String(index + 1).padStart(2, "0")}`,
    session: "FN",
    roomId: `r${index % 5}`,
  }));
  const teachers = Array.from({ length: 15 }, (_, index) => `t${index}`);
  const assignments = allocateFlexibleDuties(halls, teachers, "half");
  const assignmentCounts = teachers.map(
    (teacherId) =>
      assignments.filter((assignment) => assignment.teacherId === teacherId)
        .length,
  );
  expect(Math.max(...assignmentCounts)).toBe(2);
  expect(assignments.filter((assignment) => assignment.share === 1)).toHaveLength(
    28,
  );
  expect(assignments.filter((assignment) => assignment.share === 0.5)).toHaveLength(
    2,
  );
});

it("avoids consecutive dates and repeated halls when alternatives exist", () => {
  const halls = Array.from({ length: 20 }, (_, index) => ({
    date: `2026-09-${String(Math.floor(index / 4) + 1).padStart(2, "0")}`,
    session: "FN",
    roomId: `r${index % 4}`,
  }));
  const teachers = Array.from({ length: 15 }, (_, index) => `t${index}`);
  const assignments = allocateFlexibleDuties(halls, teachers, "half");
  for (const teacherId of teachers) {
    const duties = assignments.filter(
      (assignment) => assignment.teacherId === teacherId,
    );
    expect(new Set(duties.map((duty) => duty.roomId)).size).toBe(duties.length);
    for (let index = 0; index < duties.length; index += 1) {
      for (let other = index + 1; other < duties.length; other += 1) {
        const distance = Math.abs(
          new Date(`${duties[index].date}T00:00:00Z`).getTime() -
            new Date(`${duties[other].date}T00:00:00Z`).getTime(),
        );
        expect(distance).not.toBe(86_400_000);
      }
    }
  }
});

it("keeps full duties while making absolute totals exactly equal", () => {
  const halls = Array.from({ length: 8 }, (_, index) => ({
    date: `d${Math.floor(index / 4)}`,
    session: "FN",
    roomId: `r${index % 4}`,
  }));
  const teachers = ["a", "b", "c", "d", "e", "f"];
  const assignments = allocateFlexibleDuties(
    halls,
    teachers,
    "absolute-equal",
  );
  expect(assignments.filter((assignment) => assignment.share === 1)).toHaveLength(
    6,
  );
  const totals = teachers.map((teacherId) =>
    assignments
      .filter((assignment) => assignment.teacherId === teacherId)
      .reduce((total, assignment) => total + (assignment.share ?? 1), 0),
  );
  totals.forEach((total) => expect(total).toBeCloseTo(8 / 6));
});
