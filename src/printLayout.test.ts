import { describe, expect, it } from "vitest";
import type { Room } from "./models";
import {
  candidateIdAtSeat,
  defaultPrintSettings,
  estimatePaper,
  groupSeatingRooms,
  orientationFor,
} from "./printLayout";

const room = (
  id: string,
  rows: number,
  columns: number,
  seatsPerBench: number,
): Room => ({
  id,
  name: id,
  rows,
  columns,
  seatsPerBench,
  disabled: [],
  active: true,
});
describe("print layout planning", () => {
  it("pairs genuinely small rooms in compact mode", () =>
    expect(
      groupSeatingRooms([room("a", 3, 4, 2), room("b", 3, 4, 2)], "compact"),
    ).toHaveLength(1));
  it("keeps 5×5 and 6×8 rooms on full pages", () =>
    expect(
      groupSeatingRooms([room("a", 5, 5, 2), room("b", 6, 8, 4)], "maximum"),
    ).toHaveLength(1));
  it("chooses landscape for wide seating and portrait for narrow reports", () => {
    expect(orientationFor("seating", [room("a", 6, 8, 2)], "auto")).toBe(
      "landscape",
    );
    expect(orientationFor("duties", [], "auto")).toBe("portrait");
  });
  it("estimates duplex physical sheets", () => {
    const estimate = estimatePaper(
      { ...defaultPrintSettings, reportType: "combined", duplex: true },
      [room("a", 5, 5, 2)],
      80,
      4,
    );
    expect(estimate.pages).toBeGreaterThan(1);
    expect(estimate.sheets).toBe(Math.ceil(estimate.pages / 2));
  });
  it("uses one physical seat map for screen and print rendering", () => {
    const assignments = [{ seatId: "a:1:2:3", candidateId: "student-7" }];
    expect(candidateIdAtSeat(assignments, "a:1:2:3")).toBe("student-7");
    expect(candidateIdAtSeat(assignments, "a:1:2:0")).toBeUndefined();
  });
});
