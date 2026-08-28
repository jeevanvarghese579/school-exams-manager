import type { Room, SeatAssignment } from "./models";

export type ReportType =
  | "seating"
  | "allocation"
  | "labels"
  | "attendance"
  | "duties"
  | "class-allocation"
  | "question-count"
  | "combined";
export type PrintDensity = "comfortable" | "compact" | "maximum";
export type PrintOrientation = "auto" | "portrait" | "landscape";
export type LabelsPerPage = "auto" | "1" | "2" | "4";
export interface PrintSettings {
  reportType: ReportType;
  density: PrintDensity;
  orientation: PrintOrientation;
  labelsPerPage: LabelsPerPage;
  showSubjects: boolean;
  showNames: boolean;
  classRollOnly: boolean;
  includeEmptySeats: boolean;
  duplex: boolean;
  includeFooter: boolean;
  includeDeveloper: boolean;
  includeLabelsInCombined: boolean;
}

export const defaultPrintSettings: PrintSettings = {
  reportType: "seating",
  density: "maximum",
  orientation: "portrait",
  labelsPerPage: "auto",
  showSubjects: false,
  showNames: false,
  classRollOnly: true,
  includeEmptySeats: true,
  duplex: false,
  includeFooter: false,
  includeDeveloper: false,
  includeLabelsInCombined: false,
};
export const reportLabels: Record<ReportType, string> = {
  seating: "Seating Arrangement",
  allocation: "Room Allocation",
  labels: "Room Labels",
  attendance: "Attendance Sheets",
  duties: "Teacher Duty List",
  "class-allocation": "Class-wise Allocation",
  "question-count": "Question Paper Count",
  combined: "Combined Exam Package",
};
/** Shared by screen and print diagrams so a physical seat always resolves to the same candidate. */
export const candidateIdAtSeat = (
  assignments: SeatAssignment[],
  seatId: string,
) =>
  assignments.find((assignment) => assignment.seatId === seatId)?.candidateId;

export const isSmallRoom = (room: Room) =>
  room.rows <= 4 &&
  room.columns <= 4 &&
  room.seatsPerBench <= 4 &&
  room.rows * room.columns * room.seatsPerBench <= 48;

export function groupSeatingRooms(
  rooms: Room[],
  density: PrintDensity,
): Room[][] {
  const groups: Room[][] = [];
  for (const room of rooms) {
    const previous = groups[groups.length - 1];
    const smallRoomGrid =
      density === "compact" &&
      isSmallRoom(room) &&
      previous?.every(isSmallRoom);
    const roomsPerPage = density === "maximum" ? 4 : 2;
    if (
      density !== "comfortable" &&
      (smallRoomGrid || (density === "maximum" && Boolean(previous))) &&
      previous &&
      previous.length < roomsPerPage &&
      (density === "maximum" || smallRoomGrid)
    )
      previous.push(room);
    else groups.push([room]);
  }
  return groups;
}

export function orientationFor(
  reportType: ReportType,
  rooms: Room[],
  requested: PrintOrientation,
): "portrait" | "landscape" {
  if (requested !== "auto") return requested;
  if (reportType === "seating" || reportType === "combined")
    return rooms.some((room) => room.columns >= 5 || room.seatsPerBench >= 4)
      ? "landscape"
      : "portrait";
  if (reportType === "question-count") return "landscape";
  return "portrait";
}

export interface PageEstimate {
  sections: { label: string; pages: number }[];
  pages: number;
  sheets: number;
  orientation: "portrait" | "landscape";
}
export function estimatePaper(
  settings: PrintSettings,
  rooms: Room[],
  candidateCount: number,
  dutyCount: number,
  attendanceDateCount = 1,
  attendanceSessionCount = 1,
): PageEstimate {
  const seatingPages = groupSeatingRooms(rooms, settings.density).length;
  const labelSlots =
    settings.labelsPerPage === "auto"
      ? settings.density === "comfortable"
        ? 2
        : 4
      : Number(settings.labelsPerPage);
  const attendanceRoomsPerPage =
    settings.density === "comfortable"
      ? 4
      : settings.density === "compact"
        ? 5
        : 6;
  const attendanceRowsPerPage =
    settings.density === "comfortable"
      ? 6
      : settings.density === "compact"
        ? 10
        : 12;
  const attendanceDatesPerPage = Math.max(
    1,
    Math.floor(attendanceRowsPerPage / Math.max(1, attendanceSessionCount)),
  );
  const attendancePages =
    Math.ceil(rooms.length / attendanceRoomsPerPage) *
    Math.ceil(attendanceDateCount / attendanceDatesPerPage);
  const pages: Record<Exclude<ReportType, "combined">, number> = {
    seating: seatingPages,
    allocation: rooms.length ? 1 : 0,
    labels: Math.ceil(rooms.length / labelSlots),
    attendance: attendancePages,
    duties: dutyCount
      ? Math.ceil(dutyCount / (settings.density === "comfortable" ? 32 : 48))
      : 0,
    "class-allocation": candidateCount ? 1 : 0,
    "question-count": candidateCount ? 1 : 0,
  };
  const selected =
    settings.reportType === "combined"
      ? ([
          "allocation",
          "duties",
          "question-count",
          "seating",
          "attendance",
          ...(settings.includeLabelsInCombined ? ["labels"] : []),
        ] as Exclude<ReportType, "combined">[])
      : [settings.reportType];
  const sections = selected
    .map((type) => ({ label: reportLabels[type], pages: pages[type] }))
    .filter((section) => section.pages > 0);
  const total = sections.reduce((sum, section) => sum + section.pages, 0);
  return {
    sections,
    pages: total,
    sheets: settings.duplex ? Math.ceil(total / 2) : total,
    orientation: orientationFor(
      settings.reportType,
      rooms,
      settings.orientation,
    ),
  };
}
