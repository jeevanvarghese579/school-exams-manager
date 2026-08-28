export const APP_VERSION = "1.0.0";
export type Id = string;
export interface School {
  name: string;
  code?: string;
  academicYear: string;
  place?: string;
  principal?: string;
  coordinator?: string;
}
export interface Exam {
  name: string;
  academicYear: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  notes?: string;
  sessions: string[];
}
export interface ClassGroup {
  id: Id;
  name: string;
  section?: string;
  studentCount: number;
  rollStart: number;
  rollPrefix?: string;
  teacher?: string;
  active: boolean;
  languageCounts: Record<string, number>;
  languageRanges?: LanguageRange[];
  subjects?: ClassSubject[];
}
export interface ClassSubject {
  id: Id;
  name: string;
  type: "normal" | "second-language";
}
export interface LanguageRange {
  id: Id;
  language: string;
  fromRoll: number;
  toRoll: number;
  rolls?: string;
}
export interface Student {
  id: Id;
  name?: string;
  roll: string;
  classId: Id;
  language?: string;
  active: boolean;
  notes?: string;
}
export type TeacherTablePosition =
  | "front-left"
  | "front-center"
  | "front-right";
export interface Room {
  id: Id;
  name: string;
  building?: string;
  floor?: string;
  rows: number;
  columns: number;
  seatsPerBench: number;
  teacherTablePosition?: TeacherTablePosition;
  disabled: string[];
  active: boolean;
  notes?: string;
}
export interface Teacher {
  id: Id;
  name: string;
  shortName?: string;
  department?: string;
  phone?: string;
  maxDuties?: number;
  unavailable: string[];
  notes?: string;
}
export interface TimetableEntry {
  id: Id;
  date: string;
  session: string;
  classId: Id;
  subject: string;
  subjectCode?: string;
  type: "normal" | "language" | "none";
}
export interface SeatingRules {
  avoidSubjectBench: boolean;
  avoidSubjectSide: boolean;
  avoidSubjectFrontBack: boolean;
  avoidClassBench: boolean;
  invigilatorsPerRoom: number;
  dutyMode?: "standard" | "half" | "absolute-equal";
}
export interface Project {
  id: Id;
  name: string;
  school: School;
  exam: Exam;
  classes: ClassGroup[];
  students: Student[];
  rooms: Room[];
  teachers: Teacher[];
  timetable: TimetableEntry[];
  dutyAssignments: DutyRosterAssignment[];
  languages: string[];
  rules: SeatingRules;
  archived?: boolean;
  cloud?: boolean;
  updatedAt: number;
  createdAt: number;
}
export interface Candidate {
  id: Id;
  roll: string;
  name?: string;
  classId: Id;
  className: string;
  subject: string;
  language?: string;
}
export interface Seat {
  id: string;
  roomId: Id;
  row: number;
  column: number;
  position: number;
}
export interface SeatAssignment {
  seatId: string;
  candidateId: Id;
  locked?: boolean;
}
export interface SeatingPlan {
  id: Id;
  date: string;
  session: string;
  seed: number;
  assignments: SeatAssignment[];
  score: number;
  conflicts: string[];
  generatedAt: number;
  lockedSeatIds?: string[];
  lockedBenchIds?: string[];
}
export interface DutyAssignment {
  roomId: Id;
  teacherId: Id;
  locked?: boolean;
}
export interface DutyRosterAssignment extends DutyAssignment {
  date: string;
  session: string;
  slot: number;
  share?: number;
}
export const uid = () => crypto.randomUUID();
export const emptyProject = (): Project => {
  const now = Date.now();
  return {
    id: uid(),
    name: "New Examination",
    school: { name: "", academicYear: new Date().getFullYear().toString() },
    exam: {
      name: "",
      academicYear: new Date().getFullYear().toString(),
      startDate: "",
      endDate: "",
      startTime: "09:30",
      endTime: "12:30",
      sessions: ["Forenoon"],
    },
    classes: [],
    students: [],
    rooms: [],
    teachers: [],
    timetable: [],
    dutyAssignments: [],
    languages: [],
    rules: {
      avoidSubjectBench: true,
      avoidSubjectSide: true,
      avoidSubjectFrontBack: true,
      avoidClassBench: true,
      invigilatorsPerRoom: 1,
      dutyMode: "standard",
    },
    updatedAt: now,
    createdAt: now,
  };
};
