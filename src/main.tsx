/* eslint-disable react-refresh/only-export-components -- this file is the application entry point */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { User } from "firebase/auth";
import {
  Archive,
  BookOpen,
  CalendarDays,
  Cloud,
  Download,
  GraduationCap,
  Home,
  Lock,
  LockOpen,
  LogOut,
  MapPin,
  Plus,
  Printer,
  Settings,
  Upload,
  Users,
} from "lucide-react";
import { db, saveProject } from "./db";
import {
  firebaseReady,
  googleSignIn,
  loadCloudProjects,
  logOut,
  observeAuth,
  syncProject,
} from "./firebase";
import {
  emptyProject,
  type Candidate,
  type Project,
  type Room,
  type Seat,
  type SeatingPlan,
  type Student,
  uid,
} from "./models";
import {
  allRoomSeats,
  benchNumber,
  generateSeating,
  physicalBenches,
  roomCapacity,
  roomSeats,
  TEACHER_TABLE_LABEL,
  validateSeating,
} from "./algorithms/seating";
import {
  allocateDuties,
  allocateFlexibleDuties,
  createDutySegments,
} from "./algorithms/duties";
import {
  languageForRoll,
  validateLanguageRanges,
} from "./algorithms/languages";
import {
  candidateIdAtSeat,
  defaultPrintSettings,
  estimatePaper,
  groupSeatingRooms,
  isSmallRoom,
  reportLabels,
  type PrintSettings,
  type ReportType,
} from "./printLayout";
import "./styles.css";

type View =
  | "dashboard"
  | "setup"
  | "classes"
  | "rooms"
  | "timetable"
  | "teachers"
  | "seating"
  | "reports"
  | "about";
const START_SCREEN_KEY = "school-exams-manager:start-screen";
const formatDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value;
};
const Button = ({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button {...props}>{children}</button>
);

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [status, setStatus] = useState("Local Only");
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [cloudProjectsLoading, setCloudProjectsLoading] = useState(false);
  const [plan, setPlan] = useState<SeatingPlan | null>(null);
  const [duties, setDuties] = useState<ReturnType<typeof allocateDuties>>([]);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const currentProjectRef = useRef<Project | null>(null);
  useEffect(() => {
    currentProjectRef.current = project;
  }, [project]);
  useEffect(() => {
    db.projects.toArray().then((items) => {
      setProjects(items);
      if (localStorage.getItem(START_SCREEN_KEY) !== "true") {
        const nextProject = items.find((item) => !item.archived) ?? null;
        currentProjectRef.current = nextProject;
        setProject(nextProject);
      }
    });
  }, []);
  useEffect(
    () =>
      observeAuth((user) => {
        setFirebaseUser(user);
        setStatus(user ? "Firebase connected" : "Local Only");
      }),
    [],
  );
  useEffect(() => {
    if (!firebaseUser) {
      setCloudProjectsLoading(false);
      return;
    }
    let cancelled = false;
    setCloudProjectsLoading(true);
    setStatus("Loading Firebase projects…");
    loadCloudProjects(firebaseUser.uid)
      .then(async (cloudProjects) => {
        if (cancelled) return;
        const localProjects = await db.projects.toArray();
        const merged = new Map(localProjects.map((item) => [item.id, item]));
        for (const cloudProject of cloudProjects) {
          const localProject = merged.get(cloudProject.id);
          if (!localProject || cloudProject.updatedAt >= localProject.updatedAt) {
            merged.set(cloudProject.id, cloudProject);
          }
        }
        let mergedProjects = [...merged.values()];
        await Promise.all(mergedProjects.map((item) => saveProject(item)));
        if (cancelled) return;

        if (!currentProjectRef.current) {
          let nextProject = mergedProjects
            .filter((item) => !item.archived)
            .sort((a, b) => b.updatedAt - a.updatedAt)[0];
          const isNewProject = !nextProject;
          if (!nextProject) {
            nextProject = emptyProject();
            await saveProject(nextProject);
            mergedProjects = [...mergedProjects, nextProject];
          }
          if (cancelled) return;
          localStorage.removeItem(START_SCREEN_KEY);
          currentProjectRef.current = nextProject;
          setProject(nextProject);
          setView(isNewProject ? "setup" : "dashboard");
        }
        setProjects(mergedProjects);
        setStatus(
          cloudProjects.length
            ? `Firebase · ${cloudProjects.length} project${cloudProjects.length === 1 ? "" : "s"} loaded`
            : "Firebase connected · No cloud projects yet",
        );
      })
      .catch((error) => {
        if (cancelled) return;
        setStatus("Firebase · Could not load projects");
        console.error("Could not load Firebase projects", error);

        // Authentication still succeeded. Enter a local project even when the
        // initial cloud read is unavailable, so sign-in never strands the user
        // on the welcome screen.
        void db.projects.toArray().then(async (localProjects) => {
          if (cancelled || currentProjectRef.current) return;
          let nextProject = localProjects
            .filter((item) => !item.archived)
            .sort((a, b) => b.updatedAt - a.updatedAt)[0];
          const isNewProject = !nextProject;
          if (!nextProject) {
            nextProject = emptyProject();
            await saveProject(nextProject);
            localProjects = [...localProjects, nextProject];
          }
          if (cancelled) return;
          localStorage.removeItem(START_SCREEN_KEY);
          currentProjectRef.current = nextProject;
          setProjects(localProjects);
          setProject(nextProject);
          setView(isNewProject ? "setup" : "dashboard");
        });
      })
      .finally(() => {
        if (!cancelled) setCloudProjectsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [firebaseUser]);
  const persist = async (next: Project) => {
    setProject(next);
    setProjects((items) => [
      ...items.filter((item) => item.id !== next.id),
      next,
    ]);
    setStatus("Saving…");
    await saveProject(next);
    setStatus(firebaseUser ? "Local saved · Cloud pending" : "Local Only · Saved");
  };
  const connectFirebase = async () => {
    try {
      await googleSignIn();
    } catch (error) {
      alert(
        error instanceof Error
          ? `Could not sign in to Firebase: ${error.message}`
          : "Could not sign in to Firebase.",
      );
    }
  };
  const saveToCloud = async () => {
    if (!firebaseUser || !project) return;
    try {
      setStatus("Syncing to Firebase…");
      await syncProject(firebaseUser.uid, project);
      setStatus("Firebase · Synced");
    } catch (error) {
      setStatus("Firebase · Sync failed");
      alert(
        error instanceof Error
          ? `Could not sync this project: ${error.message}`
          : "Could not sync this project.",
      );
    }
  };
  const generateFromReports = (preserveLocks: boolean) => {
    if (!project) return;
    const firstEntry = [...project.timetable]
      .filter(
        (entry) =>
          entry.type !== "none" &&
          project.exam.sessions.includes(entry.session),
      )
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) || a.session.localeCompare(b.session),
      )[0];
    const target = plan
      ? { date: plan.date, session: plan.session }
      : firstEntry && { date: firstEntry.date, session: firstEntry.session };
    if (!target) {
      alert("Add an exam timetable session before generating seating.");
      return;
    }
    try {
      const generated = buildSeatingForSession(
        project,
        target.date,
        target.session,
        plan,
        preserveLocks,
      );
      setPlan(generated.plan);
      setDuties(generated.duties);
    } catch (error) {
      alert(
        error instanceof Error ? error.message : "Unable to generate seating",
      );
    }
  };
  const generateReportPlans = (
    targets: { date: string; session: string }[],
    preserveLocks: boolean,
  ) => {
    if (!project) return [];
    try {
      const generated = targets.map((target) =>
        buildSeatingForSession(
          project,
          target.date,
          target.session,
          plan,
          preserveLocks,
        ),
      );
      const preferred =
        generated.find(
          (item) =>
            item.plan.date === plan?.date &&
            item.plan.session === plan?.session,
        ) ?? generated[0];
      if (preferred) {
        setPlan(preferred.plan);
        setDuties(preferred.duties);
      }
      return generated.map((item) => item.plan);
    } catch (error) {
      alert(
        error instanceof Error ? error.message : "Unable to generate seating",
      );
      return [];
    }
  };
  const create = async () => {
    localStorage.removeItem(START_SCREEN_KEY);
    const next = emptyProject();
    await persist(next);
    setView("setup");
  };
  const workOffline = async () => {
    localStorage.removeItem(START_SCREEN_KEY);
    const localProjects = await db.projects.toArray();
    const nextProject = localProjects
      .filter((item) => !item.archived)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!nextProject) {
      await create();
      return;
    }
    currentProjectRef.current = nextProject;
    setProjects(localProjects);
    setProject(nextProject);
    setStatus("Local Only");
    setView("dashboard");
  };
  const leaveApp = async () => {
    try {
      if (firebaseUser) await logOut();
    } finally {
      localStorage.setItem(START_SCREEN_KEY, "true");
      setProject(null);
      setPlan(null);
      setDuties([]);
      setStatus("Local Only");
      setView("dashboard");
    }
  };
  const update = (key: keyof Project, value: unknown) =>
    project && persist({ ...project, [key]: value });
  const restore = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const backup: unknown = JSON.parse(await file.text());
      if (!isProjectBackup(backup))
        throw new Error("Not a School Exams Manager backup");
      await persist(normalizeRestoredProject(backup));
      setPlan(null);
      setDuties([]);
      setView("dashboard");
      setStatus("Local Only · Restored");
    } catch (error) {
      alert(
        error instanceof Error
          ? `Could not restore this backup: ${error.message}`
          : "Could not restore this backup.",
      );
    }
  };
  if (!project)
    return (
      <Welcome
        onWorkOffline={workOffline}
        firebaseUser={firebaseUser}
        firebaseReady={firebaseReady}
        onGoogleSignIn={connectFirebase}
        onSignOut={() => void logOut()}
        cloudProjectsLoading={cloudProjectsLoading}
        firebaseStatus={status}
      />
    );
  const nav: [View, string, React.ElementType][] = [
    ["dashboard", "Dashboard", Home],
    ["setup", "Exam setup", Settings],
    ["classes", "Classes & Subjects", Users],
    ["rooms", "Rooms", MapPin],
    ["timetable", "Exam Timetable", CalendarDays],
    ["teachers", "Teachers Duty Allotment", GraduationCap],
    ["seating", "Seating", BookOpen],
    ["reports", "Reports", Printer],
    ["about", "About", Archive],
  ];
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <span>▦</span>School Exams
          <br />
          <small>Manager</small>
        </div>
        <select
          value={project.id}
          onChange={(event) =>
            setProject(
              projects.find((item) => item.id === event.target.value) ??
                project,
            )
          }
        >
          {projects.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        {nav.map(([id, label, Icon]) => (
          <button
            className={view === id ? "active" : ""}
            key={id}
            onClick={() => setView(id)}
          >
            <Icon size={18} />
            {label}
          </button>
        ))}
        <div className="sidebottom">
          <Button onClick={create}>
            <Plus size={16} />
            New project
          </Button>
          <Button onClick={() => void leaveApp()}>
            <LogOut size={16} />
            {firebaseUser ? "Log out" : "Exit offline mode"}
          </Button>
          <small>{status}</small>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <h1>{project.name}</h1>
            <p>
              {project.school.name || "Configure your school and examination"}
            </p>
          </div>
          <div className="header-actions">
            <span className="badge">
              <Cloud size={15} />
              {status}
            </span>
            <Button onClick={() => downloadProject(project)}>
              <Download size={16} />
              Backup
            </Button>
            <Button
              className="secondary"
              onClick={() => restoreInputRef.current?.click()}
            >
              <Upload size={16} />
              Restore
            </Button>
            {firebaseUser ? (
              <>
                <Button onClick={saveToCloud} title="Save this project to Firestore">
                  <Cloud size={16} />
                  Sync
                </Button>
                <Button
                  className="secondary"
                  onClick={() => void logOut()}
                  title={`Signed in as ${firebaseUser.email ?? firebaseUser.displayName ?? "Firebase user"}`}
                >
                  {firebaseUser.email ?? "Sign out"}
                </Button>
              </>
            ) : (
              <Button
                onClick={connectFirebase}
                disabled={!firebaseReady}
                title={
                  firebaseReady
                    ? "Sign in with Google to enable cloud sync"
                    : "Firebase environment variables are missing"
                }
              >
                <Cloud size={16} />
                Sign in with Google
              </Button>
            )}
          </div>
        </header>
        <input
          ref={restoreInputRef}
          className="visually-hidden"
          type="file"
          accept="application/json,.json"
          onChange={restore}
        />
        {view === "dashboard" && (
          <Dashboard p={project} setView={setView} plan={plan} />
        )}
        {view === "setup" && <Setup p={project} save={persist} />}
        {view === "classes" && <Classes p={project} update={update} />}
        {view === "rooms" && <Rooms p={project} update={update} />}
        {view === "timetable" && <Timetable p={project} update={update} />}
        {view === "teachers" && (
          <Teachers p={project} update={update} save={persist} />
        )}
        {view === "seating" && (
          <Seating
            p={project}
            plan={plan}
            setPlan={setPlan}
            duties={duties}
            setDuties={setDuties}
          />
        )}
        {view === "reports" && (
          <Reports
            p={project}
            plan={plan}
            duties={duties}
            onGenerateSeating={() => generateFromReports(false)}
            onRegenerateUnlocked={() => generateFromReports(true)}
            onGeneratePlans={generateReportPlans}
          />
        )}
        {view === "about" && (
          <About
            onBackup={() => downloadProject(project)}
            onRestore={() => restoreInputRef.current?.click()}
          />
        )}
      </main>
    </div>
  );
}

function isProjectBackup(value: unknown): value is Project {
  if (!value || typeof value !== "object") return false;
  const backup = value as Partial<Project>;
  return (
    typeof backup.id === "string" &&
    typeof backup.name === "string" &&
    Array.isArray(backup.classes) &&
    Array.isArray(backup.rooms) &&
    Array.isArray(backup.teachers) &&
    Array.isArray(backup.timetable)
  );
}

function normalizeRestoredProject(backup: Project): Project {
  const defaults = emptyProject();
  return {
    ...defaults,
    ...backup,
    students: backup.students ?? [],
    languages: backup.languages ?? [],
    dutyAssignments: backup.dutyAssignments ?? [],
    rules: { ...defaults.rules, ...backup.rules },
    classes: backup.classes.map((group) => ({
      ...group,
      active: group.active ?? true,
      languageCounts: group.languageCounts ?? {},
      subjects: group.subjects ?? [],
      languageRanges: group.languageRanges ?? [],
    })),
    rooms: backup.rooms.map((room) => ({
      ...room,
      active: room.active ?? true,
      disabled: room.disabled ?? [],
      teacherTablePosition: room.teacherTablePosition ?? "front-center",
    })),
    updatedAt: Date.now(),
  };
}

function downloadProject(project: Project) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(
    new Blob([JSON.stringify(project, null, 2)], { type: "application/json" }),
  );
  link.download = `${project.name}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}
function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
      <path fill="#4285f4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.91h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.4Z" />
      <path fill="#34a853" d="M12 22c2.7 0 4.98-.9 6.63-2.37l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z" />
      <path fill="#fbbc05" d="M6.39 13.92A6.02 6.02 0 0 1 6.07 12c0-.67.12-1.32.32-1.92V7.46H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.54l3.35-2.62Z" />
      <path fill="#ea4335" d="M12 5.95c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.96 5.46l3.35 2.62C7.18 7.71 9.39 5.95 12 5.95Z" />
    </svg>
  );
}

function Welcome({
  onWorkOffline,
  firebaseUser,
  firebaseReady,
  onGoogleSignIn,
  onSignOut,
  cloudProjectsLoading,
  firebaseStatus,
}: {
  onWorkOffline: () => void;
  firebaseUser: User | null;
  firebaseReady: boolean;
  onGoogleSignIn: () => void;
  onSignOut: () => void;
  cloudProjectsLoading: boolean;
  firebaseStatus: string;
}) {
  return (
    <div className="welcome">
      <div className="hero">
        <div className="logo">▦</div>
        <h1>School Exams Manager</h1>
        <p>
          Plan examinations, arrange seating, assign invigilators, and print
          everything your school needs — even without internet.
        </p>
        <div className="welcome-auth">
          {firebaseUser ? (
            <>
              <span className="google-user">
                <GoogleMark />
                Signed in as {firebaseUser.email ?? firebaseUser.displayName}
              </span>
              <Button className="secondary" onClick={onSignOut}>
                Sign out
              </Button>
            </>
          ) : (
            <Button
              className="google-login"
              onClick={onGoogleSignIn}
              disabled={!firebaseReady}
            >
              <GoogleMark />
              Sign in with Google
            </Button>
          )}
        </div>
        <div className="welcome-actions">
          <Button onClick={onWorkOffline} disabled={cloudProjectsLoading}>
            <BookOpen />
            Work offline
          </Button>
        </div>
        <small>
          {firebaseUser
            ? firebaseStatus
            : "Sign in for Firebase cloud sync, or continue offline on this device."}
        </small>
      </div>
    </div>
  );
}
const Dashboard = ({
  p,
  setView,
  plan,
}: {
  p: Project;
  setView: (view: View) => void;
  plan: SeatingPlan | null;
}) => (
  <>
    <section className="grid stats">
      {[
        [
          "Students",
          p.classes.reduce((total, item) => total + item.studentCount, 0),
        ],
        ["Classes", p.classes.length],
        ["Rooms", p.rooms.length],
        ["Seating capacity", roomSeats(p.rooms).length],
        ["Teachers", p.teachers.length],
        [
          "Exam days",
          p.exam.startDate && p.exam.endDate
            ? `${formatDate(p.exam.startDate)} → ${formatDate(p.exam.endDate)}`
            : "—",
        ],
        ["Seating plans", plan ? 1 : 0],
        ["Timetable entries", p.timetable.length],
      ].map(([label, value]) => (
        <article key={label}>
          <small>{label}</small>
          <strong>{value}</strong>
        </article>
      ))}
    </section>
    <section className="panel">
      <h2>Setup checklist</h2>
      {[
        ["School configured", !!p.school.name, "setup"],
        ["Classes added", p.classes.length > 0, "classes"],
        ["Active rooms", roomSeats(p.rooms).length > 0, "rooms"],
        ["Timetable configured", p.timetable.length > 0, "timetable"],
        ["Teachers added", p.teachers.length > 0, "teachers"],
      ].map(([label, ok, target]) => (
        <button
          className="check"
          onClick={() => setView(target as View)}
          key={String(label)}
        >
          <span>{ok ? "✓" : "!"}</span>
          {label}
        </button>
      ))}
    </section>
    <section className="panel">
      <h2>Quick actions</h2>
      <div className="actions">
        <Button onClick={() => setView("seating")}>Generate seating</Button>
        <Button onClick={() => setView("reports")}>Open reports</Button>
        <Button onClick={() => setView("timetable")}>Edit timetable</Button>
      </div>
    </section>
  </>
);

function Setup({ p, save }: { p: Project; save: (project: Project) => void }) {
  const [rawSessions, setRawSessions] = useState(p.exam.sessions.join(", "));
  const set = (path: "school" | "exam", key: string, value: string) => {
    const nextProject = {
      ...p,
      [path]: { ...p[path], [key]: value },
    };
    save(
      path === "exam" && key === "name"
        ? { ...nextProject, name: value.trim() || "New Examination" }
        : nextProject,
    );
  };
  return (
    <section className="panel form">
      <h2>Exam setup</h2>
      <h3>School</h3>
      <label>
        School name
        <input
          value={p.school.name}
          onChange={(event) => set("school", "name", event.target.value)}
        />
      </label>
      <label>
        Academic year
        <input
          value={p.school.academicYear}
          onChange={(event) =>
            set("school", "academicYear", event.target.value)
          }
        />
      </label>
      <label>
        Place
        <input
          value={p.school.place ?? ""}
          onChange={(event) => set("school", "place", event.target.value)}
        />
      </label>
      <label>
        Exam coordinator
        <input
          value={p.school.coordinator ?? ""}
          onChange={(event) => set("school", "coordinator", event.target.value)}
        />
      </label>
      <h3>Examination</h3>
      <label>
        Examination name
        <input
          value={p.exam.name}
          onChange={(event) => set("exam", "name", event.target.value)}
        />
      </label>
      <label>
        Start date
        <input
          type="date"
          value={p.exam.startDate}
          onChange={(event) => set("exam", "startDate", event.target.value)}
        />
      </label>
      <label>
        End date
        <input
          type="date"
          value={p.exam.endDate}
          onChange={(event) => set("exam", "endDate", event.target.value)}
        />
      </label>
      <label>
        Sessions (comma-separated)
        <input
          value={rawSessions}
          onChange={(event) => setRawSessions(event.target.value)}
          onBlur={() => {
            const sessions = rawSessions
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean);
            save({
              ...p,
              exam: { ...p.exam, sessions },
              timetable: p.timetable.filter((entry) =>
                sessions.includes(entry.session),
              ),
            });
          }}
        />
      </label>
    </section>
  );
}

function Classes({ p, update }: ProjectEditorProps) {
  const [rawLanguages, setRawLanguages] = useState(p.languages.join(", "));
  const add = () =>
    update("classes", [
      ...p.classes,
      {
        id: uid(),
        name: "New class",
        studentCount: 0,
        rollStart: 1,
        active: true,
        languageCounts: {},
      },
    ]);
  const changeSubjects = (
    classId: string,
    subjects: NonNullable<(typeof p.classes)[number]["subjects"]>,
  ) =>
    update(
      "classes",
      p.classes.map((group) =>
        group.id === classId ? { ...group, subjects } : group,
      ),
    );
  const changeRanges = (
    classId: string,
    ranges: NonNullable<(typeof p.classes)[number]["languageRanges"]>,
  ) =>
    update(
      "classes",
      p.classes.map((group) =>
        group.id === classId ? { ...group, languageRanges: ranges } : group,
      ),
    );
  const saveLanguages = () =>
    update(
      "languages",
      rawLanguages
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );
  return (
    <section className="panel">
      <div className="row">
        <h2>Classes & Subjects</h2>
        <Button onClick={add}>
          <Plus />
          Add class
        </Button>
      </div>
      <p className="muted">
        Individual active student records are used when present; otherwise roll
        numbers are generated from the class count.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Class</th>
              <th>Students</th>
              <th>Roll start</th>
              <th>Teacher</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {p.classes.map((group) => (
              <tr key={group.id}>
                <td>
                  <input
                    value={group.name}
                    onChange={(event) =>
                      update(
                        "classes",
                        p.classes.map((item) =>
                          item.id === group.id
                            ? { ...item, name: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    value={group.studentCount}
                    onChange={(event) =>
                      update(
                        "classes",
                        p.classes.map((item) =>
                          item.id === group.id
                            ? {
                                ...item,
                                studentCount: Math.max(0, +event.target.value),
                              }
                            : item,
                        ),
                      )
                    }
                  />
                </td>
                <td>{group.rollStart}</td>
                <td>{group.teacher ?? "—"}</td>
                <td>
                  <button
                    className="danger"
                    onClick={() =>
                      confirm(`Delete ${group.name}?`) &&
                      update(
                        "classes",
                        p.classes.filter((item) => item.id !== group.id),
                      )
                    }
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="class-subjects">
        <div>
          <h2>Subjects by class</h2>
          <p className="muted">
            Subjects belong to a class. Second Language is explicitly marked and
            does not behave like a normal subject.
          </p>
        </div>
        {p.classes.map((group) => (
          <article key={group.id}>
            <div className="row">
              <h3>
                {group.name} — {group.studentCount} students
              </h3>
              <div className="actions">
                <Button
                  className="secondary"
                  onClick={() =>
                    changeSubjects(group.id, [
                      ...(group.subjects ?? []),
                      { id: uid(), name: "New subject", type: "normal" },
                    ])
                  }
                >
                  <Plus />
                  Add subject
                </Button>
                {!(group.subjects ?? []).some(
                  (subject) => subject.type === "second-language",
                ) && (
                  <Button
                    className="secondary"
                    onClick={() =>
                      changeSubjects(group.id, [
                        ...(group.subjects ?? []),
                        {
                          id: uid(),
                          name: "Second Language",
                          type: "second-language",
                        },
                      ])
                    }
                  >
                    <Plus />
                    Second Language
                  </Button>
                )}
              </div>
            </div>
            {(group.subjects ?? []).length === 0 ? (
              <small>
                Add subjects for this class; existing timetable text remains
                supported.
              </small>
            ) : (
              <div className="subject-list">
                {(group.subjects ?? []).map((subject, index) => (
                  <div key={subject.id}>
                    <input
                      value={subject.name}
                      onChange={(event) =>
                        changeSubjects(
                          group.id,
                          (group.subjects ?? []).map((item) =>
                            item.id === subject.id
                              ? { ...item, name: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                    <em>
                      {subject.type === "second-language"
                        ? "Second Language"
                        : "Normal"}
                    </em>
                    <button
                      disabled={index === 0}
                      onClick={() => {
                        const next = [...(group.subjects ?? [])];
                        [next[index - 1], next[index]] = [
                          next[index],
                          next[index - 1],
                        ];
                        changeSubjects(group.id, next);
                      }}
                    >
                      ↑
                    </button>
                    <button
                      disabled={index === (group.subjects ?? []).length - 1}
                      onClick={() => {
                        const next = [...(group.subjects ?? [])];
                        [next[index], next[index + 1]] = [
                          next[index + 1],
                          next[index],
                        ];
                        changeSubjects(group.id, next);
                      }}
                    >
                      ↓
                    </button>
                    <button
                      className="danger"
                      onClick={() =>
                        changeSubjects(
                          group.id,
                          (group.subjects ?? []).filter(
                            (item) => item.id !== subject.id,
                          ),
                        )
                      }
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </article>
        ))}
      </section>
      <section className="language-ranges">
        <div>
          <h2>Second languages</h2>
          <p className="muted">
            List the languages your school offers, then set the roll-number
            ranges that write each language in every class.
          </p>
          <label className="language-offered-input">
            Second languages offered (comma-separated)
            <input
              value={rawLanguages}
              placeholder="Hindi, Malayalam, Arabic"
              onChange={(event) => setRawLanguages(event.target.value)}
              onBlur={saveLanguages}
            />
          </label>
        </div>
        {p.classes
          .filter((group) => group.active)
          .map((group) => {
            const validation = validateLanguageRanges(
              group.languageRanges ?? [],
              group.rollStart,
              group.studentCount,
            );
            return (
              <article key={group.id}>
                <div className="row">
                  <b>{group.name}</b>
                  <Button
                    className="secondary"
                    onClick={() =>
                      changeRanges(group.id, [
                        ...(group.languageRanges ?? []),
                        {
                          id: uid(),
                          language: p.languages[0] ?? "",
                          fromRoll: group.rollStart,
                          toRoll: group.rollStart,
                          rolls: "",
                        },
                      ])
                    }
                  >
                    <Plus />
                    Add language range
                  </Button>
                </div>
                {(group.languageRanges ?? []).length === 0 ? (
                  <small>
                    Use “Add language range” to set roll ranges for this class.
                  </small>
                ) : (
                  <>
                    <div className="range-grid">
                      {(group.languageRanges ?? []).map((range) => (
                        <div key={range.id}>
                          <select
                            value={range.language}
                            onChange={(event) =>
                              changeRanges(
                                group.id,
                                (group.languageRanges ?? []).map((item) =>
                                  item.id === range.id
                                    ? { ...item, language: event.target.value }
                                    : item,
                                ),
                              )
                            }
                          >
                            {p.languages.length ? (
                              p.languages.map((language) => (
                                <option key={language}>{language}</option>
                              ))
                            ) : (
                              <option value="">Add languages above</option>
                            )}
                          </select>
                          <input
                            value={
                              range.rolls ?? `${range.fromRoll}-${range.toRoll}`
                            }
                            placeholder="1-10, 14, 16-22"
                            aria-label={`${group.name} language roll list`}
                            onChange={(event) =>
                              changeRanges(
                                group.id,
                                (group.languageRanges ?? []).map((item) =>
                                  item.id === range.id
                                    ? { ...item, rolls: event.target.value }
                                    : item,
                                ),
                              )
                            }
                          />
                          <button
                            className="danger"
                            onClick={() =>
                              changeRanges(
                                group.id,
                                (group.languageRanges ?? []).filter(
                                  (item) => item.id !== range.id,
                                ),
                              )
                            }
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                    <div
                      className={
                        validation.duplicates.length ||
                        validation.missing.length ||
                        validation.outside.length ||
                        validation.malformed.length
                          ? "language-validation warning"
                          : "language-validation success"
                      }
                    >
                      <div>
                        {p.languages.map((language) => (
                          <span key={language}>
                            {language}:{" "}
                            <b>{validation.counts[language] ?? 0}</b>
                          </span>
                        ))}
                        <span>
                          Total:{" "}
                          <b>
                            {Object.values(validation.counts).reduce(
                              (sum, count) => sum + count,
                              0,
                            )}
                          </b>{" "}
                          / {group.studentCount}
                        </span>
                      </div>
                      {validation.duplicates.length > 0 && (
                        <p>
                          Duplicate rolls: {validation.duplicates.join(", ")}
                        </p>
                      )}
                      {validation.missing.length > 0 && (
                        <p>Unassigned rolls: {validation.missing.join(", ")}</p>
                      )}
                      {validation.outside.length > 0 && (
                        <p>
                          Outside class range: {validation.outside.join(", ")}
                        </p>
                      )}
                      {validation.malformed.length > 0 && (
                        <p>
                          Malformed entries: {validation.malformed.join(", ")}
                        </p>
                      )}
                    </div>
                  </>
                )}
              </article>
            );
          })}
      </section>
    </section>
  );
}

type ProjectEditorProps = {
  p: Project;
  update: (key: keyof Project, value: unknown) => void;
};
function Rooms({ p, update }: ProjectEditorProps) {
  const add = () =>
    update("rooms", [
      ...p.rooms,
      {
        id: uid(),
        name: "New room",
        rows: 4,
        columns: 5,
        seatsPerBench: 2,
        teacherTablePosition: "front-center" as const,
        disabled: [],
        active: true,
      },
    ]);
  const change = (id: string, values: Partial<Room>) =>
    update(
      "rooms",
      p.rooms.map((room) => (room.id === id ? { ...room, ...values } : room)),
    );
  return (
    <section className="panel">
      <div className="row">
        <div>
          <h2>Room manager</h2>
          <p className="muted">
            Each room has independent bench geometry and teacher-table
            placement.
          </p>
        </div>
        <Button onClick={add}>
          <Plus />
          Add room
        </Button>
      </div>
      <div className="room-editor-list">
        {p.rooms.map((room) => (
          <article className="room-editor" key={room.id}>
            <div className="room-editor-fields">
              <label>
                Room name / number
                <input
                  value={room.name}
                  onChange={(event) =>
                    change(room.id, { name: event.target.value })
                  }
                />
              </label>
              <label>
                Bench rows
                <input
                  type="number"
                  min="1"
                  value={room.rows}
                  onChange={(event) =>
                    change(room.id, { rows: Math.max(1, +event.target.value) })
                  }
                />
              </label>
              <label>
                Bench columns
                <input
                  type="number"
                  min="1"
                  value={room.columns}
                  onChange={(event) =>
                    change(room.id, {
                      columns: Math.max(1, +event.target.value),
                    })
                  }
                />
              </label>
              <label>
                Students per bench
                <input
                  type="number"
                  min="1"
                  value={room.seatsPerBench}
                  onChange={(event) =>
                    change(room.id, {
                      seatsPerBench: Math.max(1, +event.target.value),
                    })
                  }
                />
              </label>
              <label>
                Teacher's table
                <select
                  value={room.teacherTablePosition ?? "front-center"}
                  onChange={(event) =>
                    change(room.id, {
                      teacherTablePosition: event.target
                        .value as Room["teacherTablePosition"],
                    })
                  }
                >
                  <option value="front-center">Front center</option>
                  <option value="front-left">Front left</option>
                  <option value="front-right">Front right</option>
                </select>
              </label>
              <label className="active-toggle">
                <input
                  type="checkbox"
                  checked={room.active}
                  onChange={(event) =>
                    change(room.id, { active: event.target.checked })
                  }
                />
                Active
              </label>
            </div>
            <div className="room-totals">
              <span>
                Total benches <b>{room.rows * room.columns}</b>
              </span>
              <span>
                Room capacity <b>{roomCapacity(room)}</b>
              </span>
              <span>
                Available <b>{roomSeats([{ ...room, active: true }]).length}</b>
              </span>
            </div>
            <details>
              <summary>Disable individual seats</summary>
              <div
                className="disable-grid"
                style={{
                  gridTemplateColumns: `repeat(${room.columns}, minmax(70px, 1fr))`,
                }}
              >
                {allRoomSeats([{ ...room, active: true }]).map((seat) => (
                  <button
                    key={seat.id}
                    className={
                      room.disabled.includes(seat.id)
                        ? "disabled-seat"
                        : "secondary"
                    }
                    onClick={() =>
                      change(room.id, {
                        disabled: room.disabled.includes(seat.id)
                          ? room.disabled.filter((id) => id !== seat.id)
                          : [...room.disabled, seat.id],
                      })
                    }
                  >
                    R{seat.row + 1} C{seat.column + 1} S{seat.position + 1}
                  </button>
                ))}
              </div>
            </details>
            <button
              className="danger"
              onClick={() =>
                confirm(`Delete ${room.name}?`) &&
                update(
                  "rooms",
                  p.rooms.filter((item) => item.id !== room.id),
                )
              }
            >
              Delete room
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function LegacyTimetable({ p, update }: ProjectEditorProps) {
  const add = () =>
    update("timetable", [
      ...p.timetable,
      {
        id: uid(),
        date: p.exam.startDate,
        session: p.exam.sessions[0] ?? "Forenoon",
        classId: p.classes[0]?.id ?? "",
        subject: "",
        type: "normal" as const,
      },
    ]);
  return (
    <section className="panel">
      <div className="row">
        <h2>Exam Timetable</h2>
        <Button disabled={!p.classes.length} onClick={add}>
          <Plus />
          Add exam
        </Button>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Session</th>
              <th>Class</th>
              <th>Subject</th>
              <th>Type</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {p.timetable.map((entry) => (
              <tr key={entry.id}>
                <td>
                  <input
                    type="date"
                    value={entry.date}
                    onChange={(event) =>
                      update(
                        "timetable",
                        p.timetable.map((item) =>
                          item.id === entry.id
                            ? { ...item, date: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <select
                    value={entry.session}
                    onChange={(event) =>
                      update(
                        "timetable",
                        p.timetable.map((item) =>
                          item.id === entry.id
                            ? { ...item, session: event.target.value }
                            : item,
                        ),
                      )
                    }
                  >
                    {p.exam.sessions.map((session) => (
                      <option key={session}>{session}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={entry.classId}
                    onChange={(event) =>
                      update(
                        "timetable",
                        p.timetable.map((item) =>
                          item.id === entry.id
                            ? { ...item, classId: event.target.value }
                            : item,
                        ),
                      )
                    }
                  >
                    {p.classes.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    value={entry.subject}
                    onChange={(event) =>
                      update(
                        "timetable",
                        p.timetable.map((item) =>
                          item.id === entry.id
                            ? { ...item, subject: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <select
                    value={entry.type}
                    onChange={(event) =>
                      update(
                        "timetable",
                        p.timetable.map((item) =>
                          item.id === entry.id
                            ? {
                                ...item,
                                type: event.target.value as
                                  | "normal"
                                  | "language",
                              }
                            : item,
                        ),
                      )
                    }
                  >
                    <option value="normal">Normal</option>
                    <option value="language">Second language</option>
                  </select>
                </td>
                <td>
                  <button
                    className="danger"
                    onClick={() =>
                      update(
                        "timetable",
                        p.timetable.filter((item) => item.id !== entry.id),
                      )
                    }
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Timetable(props: ProjectEditorProps) {
  if (!props.p.classes.length) return <LegacyTimetable {...props} />;
  return <DateTimetable {...props} />;
}

function DateTimetable({ p, update }: ProjectEditorProps) {
  const [date, setDate] = useState(p.exam.startDate);
  const [session, setSession] = useState(p.exam.sessions[0] ?? "Forenoon");
  const [notice, setNotice] = useState("");
  const [showLegacyLanguageEditor] = useState(false);
  useEffect(() => {
    if (!p.exam.sessions.includes(session)) {
      setSession(p.exam.sessions[0] ?? "");
    }
  }, [p.exam.sessions, session]);
  const entries = p.timetable.filter(
    (entry) => entry.date === date && entry.session === session,
  );
  const createdSessions = useMemo(
    () =>
      [
        ...new Map(
          p.timetable
            .filter((entry) => p.exam.sessions.includes(entry.session))
            .map((entry) => [
              `${entry.date}|${entry.session}`,
              { date: entry.date, session: entry.session },
            ]),
        ).values(),
      ].sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          Number(/afternoon/i.test(a.session)) -
            Number(/afternoon/i.test(b.session)) ||
          a.session.localeCompare(b.session),
      ),
    [p.exam.sessions, p.timetable],
  );
  const updateEntry = (
    classId: string,
    values: Partial<(typeof p.timetable)[number]>,
  ) => {
    const existing = entries.find((entry) => entry.classId === classId);
    if (existing)
      update(
        "timetable",
        p.timetable.map((entry) =>
          entry.id === existing.id ? { ...entry, ...values } : entry,
        ),
      );
    else
      update("timetable", [
        ...p.timetable,
        {
          id: uid(),
          date,
          session,
          classId,
          subject: "",
          type: "normal",
          ...values,
        },
      ]);
  };
  const addDate = () => {
    if (!date || !session) {
      setNotice("Select an exam date and session first.");
      return;
    }
    const missing = p.classes.filter(
      (group) =>
        group.active && !entries.some((entry) => entry.classId === group.id),
    );
    if (missing.length) {
      update("timetable", [
        ...p.timetable,
        ...missing.map((group) => ({
          id: uid(),
          date,
          session,
          classId: group.id,
          subject: "",
          type: "normal" as const,
        })),
      ]);
      setNotice(
        `${formatDate(date)} · ${session} added. Enter the subject for each class below.`,
      );
    } else {
      setNotice("This date and session is already in the timetable.");
    }
  };
  const changeRanges = (
    classId: string,
    ranges: NonNullable<(typeof p.classes)[number]["languageRanges"]>,
  ) =>
    update(
      "classes",
      p.classes.map((group) =>
        group.id === classId ? { ...group, languageRanges: ranges } : group,
      ),
    );
  const deleteDateSession = (item: { date: string; session: string }) => {
    if (!confirm(`Delete the ${item.session} timetable on ${formatDate(item.date)}?`))
      return;
    update(
      "timetable",
      p.timetable.filter(
        (entry) => entry.date !== item.date || entry.session !== item.session,
      ),
    );
    setNotice(`${formatDate(item.date)} · ${item.session} was deleted.`);
  };
  return (
    <section className="panel">
      <div className="row">
        <div>
          <h2>Exam timetable</h2>
          <p className="muted">
            Add a date and session; every active class appears automatically so
            subjects can be entered quickly.
          </p>
        </div>
        <Button onClick={addDate}>
          <Plus />
          Add date / session
        </Button>
      </div>
      <div className="timetable-controls">
        <label>
          Exam date
          <input
            type="date"
            value={date}
            min={p.exam.startDate}
            max={p.exam.endDate}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <label>
          Session
          <select
            value={session}
            onChange={(event) => setSession(event.target.value)}
          >
            {p.exam.sessions.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
      </div>
      {notice && <p className="success">{notice}</p>}
      {!entries.length ? (
        <p className="warning">
          No class rows have been added for this date/session. Select the date
          and click “Add date / session”.
        </p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Class</th>
                <th>Subject / Exam type</th>
              </tr>
            </thead>
            <tbody>
              {p.classes
                .filter((group) => group.active)
                .map((group) => {
                  const entry = entries.find(
                    (item) => item.classId === group.id,
                  );
                  return (
                    <tr key={group.id}>
                      <td>
                        <b>{group.name}</b>
                      </td>
                      <td colSpan={2}>
                        <select
                          value={
                            entry?.type === "language"
                              ? "language"
                              : entry?.type === "none"
                                ? "none"
                                : `normal:${entry?.subject ?? ""}`
                          }
                          onChange={(event) => {
                            const value = event.target.value;
                            updateEntry(
                              group.id,
                              value === "language"
                                ? {
                                    subject: "Second Language",
                                    type: "language",
                                  }
                                : value === "none"
                                  ? { subject: "", type: "none" }
                                  : { subject: value.slice(7), type: "normal" },
                            );
                          }}
                        >
                          <option value="none">No Exam</option>
                          {(group.subjects ?? [])
                            .filter((subject) => subject.type === "normal")
                            .map((subject) => (
                              <option
                                key={subject.id}
                                value={`normal:${subject.name}`}
                              >
                                {subject.name}
                              </option>
                            ))}
                          {(group.subjects ?? []).some(
                            (subject) => subject.type === "second-language",
                          ) && (
                            <option value="language">Second Language</option>
                          )}
                          {!(group.subjects ?? []).length && entry?.subject && (
                            <option value={`normal:${entry.subject}`}>
                              {entry.subject} (legacy subject)
                            </option>
                          )}
                        </select>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
      <section className="created-timetable">
        <div>
          <h3>Created exam timetables</h3>
          <p className="muted">
            Open a date and session to edit its class subjects, or delete it
            when it is no longer needed.
          </p>
        </div>
        {createdSessions.length === 0 ? (
          <p className="muted">No exam timetables have been created yet.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Session</th>
                  <th>Classes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {createdSessions.map((item) => {
                  const classCount = p.timetable.filter(
                    (entry) =>
                      entry.date === item.date &&
                      entry.session === item.session,
                  ).length;
                  return (
                    <tr key={`${item.date}|${item.session}`}>
                      <td>{formatDate(item.date)}</td>
                      <td>{item.session}</td>
                      <td>{classCount} classes</td>
                      <td>
                        <div className="actions">
                          <Button
                            className="secondary"
                            onClick={() => {
                              setDate(item.date);
                              setSession(item.session);
                              setNotice(
                                `Editing ${formatDate(item.date)} · ${item.session}.`,
                              );
                            }}
                          >
                            Edit
                          </Button>
                          <button
                            className="danger"
                            onClick={() => deleteDateSession(item)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {showLegacyLanguageEditor && (
        <section className="language-ranges">
          <div>
            <h3>Second-language roll ranges</h3>
            <p className="muted">
              Define which roll-number ranges write each language. These ranges
              are used when a class has a Second language exam.
            </p>
          </div>
          {p.classes
            .filter((group) => group.active)
            .map((group) => {
              const validation = validateLanguageRanges(
                group.languageRanges ?? [],
                group.rollStart,
                group.studentCount,
              );
              return (
                <article key={group.id}>
                  <div className="row">
                    <b>{group.name}</b>
                    <Button
                      className="secondary"
                      onClick={() =>
                        changeRanges(group.id, [
                          ...(group.languageRanges ?? []),
                          {
                            id: uid(),
                            language: p.languages[0] ?? "",
                            fromRoll: group.rollStart,
                            toRoll: group.rollStart,
                            rolls: "",
                          },
                        ])
                      }
                    >
                      <Plus />
                      Add language range
                    </Button>
                  </div>
                  {(group.languageRanges ?? []).length === 0 ? (
                    <small>
                      Use “Add language range” to set roll ranges for this
                      class.
                    </small>
                  ) : (
                    <>
                      <div className="range-grid">
                        {(group.languageRanges ?? []).map((range) => (
                          <div key={range.id}>
                            <select
                              value={range.language}
                              onChange={(event) =>
                                changeRanges(
                                  group.id,
                                  (group.languageRanges ?? []).map((item) =>
                                    item.id === range.id
                                      ? {
                                          ...item,
                                          language: event.target.value,
                                        }
                                      : item,
                                  ),
                                )
                              }
                            >
                              {p.languages.length ? (
                                p.languages.map((language) => (
                                  <option key={language}>{language}</option>
                                ))
                              ) : (
                                <option value="">Add languages above</option>
                              )}
                            </select>
                            <input
                              value={
                                range.rolls ??
                                `${range.fromRoll}-${range.toRoll}`
                              }
                              placeholder="1-10, 14, 16-22"
                              aria-label={`${group.name} language roll list`}
                              onChange={(event) =>
                                changeRanges(
                                  group.id,
                                  (group.languageRanges ?? []).map((item) =>
                                    item.id === range.id
                                      ? { ...item, rolls: event.target.value }
                                      : item,
                                  ),
                                )
                              }
                            />
                            <button
                              className="danger"
                              onClick={() =>
                                changeRanges(
                                  group.id,
                                  (group.languageRanges ?? []).filter(
                                    (item) => item.id !== range.id,
                                  ),
                                )
                              }
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                      <div
                        className={
                          validation.duplicates.length ||
                          validation.missing.length ||
                          validation.outside.length ||
                          validation.malformed.length
                            ? "language-validation warning"
                            : "language-validation success"
                        }
                      >
                        <div>
                          {p.languages.map((language) => (
                            <span key={language}>
                              {language}:{" "}
                              <b>{validation.counts[language] ?? 0}</b>
                            </span>
                          ))}
                          <span>
                            Total:{" "}
                            <b>
                              {Object.values(validation.counts).reduce(
                                (sum, count) => sum + count,
                                0,
                              )}
                            </b>{" "}
                            / {group.studentCount}
                          </span>
                        </div>
                        {validation.duplicates.length > 0 && (
                          <p>
                            Duplicate rolls: {validation.duplicates.join(", ")}
                          </p>
                        )}
                        {validation.missing.length > 0 && (
                          <p>
                            Unassigned rolls: {validation.missing.join(", ")}
                          </p>
                        )}
                        {validation.outside.length > 0 && (
                          <p>
                            Outside class range: {validation.outside.join(", ")}
                          </p>
                        )}
                        {validation.malformed.length > 0 && (
                          <p>
                            Malformed entries: {validation.malformed.join(", ")}
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </article>
              );
            })}
        </section>
      )}
    </section>
  );
}

function Teachers({
  p,
  update,
  save,
}: ProjectEditorProps & { save: (project: Project) => void }) {
  const [teacherName, setTeacherName] = useState("");
  const dutyAssignments = p.dutyAssignments ?? [];
  const sessions = useMemo(
    () =>
      [
        ...new Map(
          p.timetable
            .filter(
              (entry) =>
                entry.type !== "none" &&
                p.exam.sessions.includes(entry.session),
            )
            .map((entry) => [
              `${entry.date}|${entry.session}`,
              { date: entry.date, session: entry.session },
            ]),
        ).values(),
      ].sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          (/(^|\s)forenoon\b/i.test(a.session)
            ? 0
            : /afternoon/i.test(a.session)
              ? 1
              : 2) -
            (/(^|\s)forenoon\b/i.test(b.session)
              ? 0
              : /afternoon/i.test(b.session)
                ? 1
                : 2) ||
          a.session.localeCompare(b.session),
      ),
    [p.exam.sessions, p.timetable],
  );
  const rooms = p.rooms.filter((room) => room.active);
  const dutyMode = p.rules.dutyMode ?? "standard";
  const halls = useMemo(
    () =>
      sessions.flatMap((item) =>
        rooms.map((room) => ({ ...item, room, roomId: room.id })),
      ),
    [rooms, sessions],
  );
  const slots = useMemo(
    () => {
      if (dutyMode === "standard")
        return halls.flatMap((hall) =>
          Array.from(
            { length: p.rules.invigilatorsPerRoom },
            (_, index) => ({
              ...hall,
              slot: index + 1,
              share: 1,
              key: `${hall.date}|${hall.session}|${hall.room.id}|${index + 1}`,
            }),
          ),
        );
      return createDutySegments(halls.length, p.teachers.length, dutyMode).map(
        (segment) => {
          const hall = halls[segment.hallIndex];
          return {
            ...hall,
            slot: segment.slot,
            share: segment.share,
            key: `${hall.date}|${hall.session}|${hall.room.id}|${segment.slot}`,
          };
        },
      );
    },
    [dutyMode, halls, p.rules.invigilatorsPerRoom, p.teachers.length],
  );
  const assignmentFor = (slot: (typeof slots)[number]) =>
    dutyAssignments.find(
      (assignment) =>
        assignment.date === slot.date &&
        assignment.session === slot.session &&
        assignment.roomId === slot.room.id &&
        assignment.slot === slot.slot,
    );
  const counts = p.teachers.reduce<Record<string, [number, number]>>(
    (result, teacher) => {
      const assignments = dutyAssignments.filter(
        (item) => item.teacherId === teacher.id,
      );
      result[teacher.id] = [
        assignments
          .filter((item) => /forenoon/i.test(item.session))
          .reduce((total, item) => total + (item.share ?? 1), 0),
        assignments
          .filter((item) => /afternoon/i.test(item.session))
          .reduce((total, item) => total + (item.share ?? 1), 0),
      ];
      return result;
    },
    {},
  );
  const saveAssignments = (assignments: typeof dutyAssignments) =>
    update("dutyAssignments", assignments);
  const canAssign = (
    teacherId: string,
    target: (typeof slots)[number],
    ignored: string[] = [],
  ) =>
    !dutyAssignments.some((assignment) => {
      const key = `${assignment.date}|${assignment.session}|${assignment.roomId}|${assignment.slot}`;
      return (
        !ignored.includes(key) &&
        assignment.teacherId === teacherId &&
        assignment.date === target.date &&
        assignment.session === target.session &&
        (dutyMode === "standard" ||
          assignment.roomId === target.room.id)
      );
    });
  const assign = (target: (typeof slots)[number], teacherId: string) => {
    if (!canAssign(teacherId, target, [target.key])) {
      alert("This teacher already has a duty in this date and session.");
      return;
    }
    saveAssignments([
      ...dutyAssignments.filter(
        (item) =>
          item.date !== target.date ||
          item.session !== target.session ||
          item.roomId !== target.room.id ||
          item.slot !== target.slot,
      ),
      {
        date: target.date,
        session: target.session,
        roomId: target.room.id,
        slot: target.slot,
        share: target.share,
        teacherId,
      },
    ]);
  };
  const moveOrSwap = (
    target: (typeof slots)[number],
    payload: { teacherId: string; sourceKey?: string },
  ) => {
    const source = payload.sourceKey
      ? slots.find((slot) => slot.key === payload.sourceKey)
      : undefined;
    if (source?.key === target.key) return;
    const targetAssignment = assignmentFor(target);
    if (!source) return assign(target, payload.teacherId);
    const sourceAssignment = assignmentFor(source);
    if (!sourceAssignment) return assign(target, payload.teacherId);
    const ignored = [source.key, target.key];
    if (!canAssign(payload.teacherId, target, ignored)) {
      alert("This teacher already has a duty in this date and session.");
      return;
    }
    if (
      targetAssignment &&
      !canAssign(targetAssignment.teacherId, source, ignored)
    ) {
      alert("These two duties cannot be interchanged in the same session.");
      return;
    }
    const remaining = dutyAssignments.filter((item) => {
      const key = `${item.date}|${item.session}|${item.roomId}|${item.slot}`;
      return !ignored.includes(key);
    });
    remaining.push({
      date: target.date,
      session: target.session,
      roomId: target.room.id,
      slot: target.slot,
      share: target.share,
      teacherId: payload.teacherId,
    });
    if (targetAssignment)
      remaining.push({
        date: source.date,
        session: source.session,
        roomId: source.room.id,
        slot: source.slot,
        share: source.share,
        teacherId: targetAssignment.teacherId,
      });
    saveAssignments(remaining);
  };
  const hasBothSessions = (teacherId: string | undefined, date: string) =>
    Boolean(teacherId) &&
    dutyAssignments.some(
      (item) =>
        item.teacherId === teacherId &&
        item.date === date &&
        /forenoon/i.test(item.session),
    ) &&
    dutyAssignments.some(
      (item) =>
        item.teacherId === teacherId &&
        item.date === date &&
        /afternoon/i.test(item.session),
    );
  const setDutyMode = (mode: "half" | "absolute-equal", enabled: boolean) => {
    const nextMode = enabled ? mode : "standard";
    const teacherIds = [...p.teachers]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((teacher) => teacher.id);
    const nextAssignments =
      nextMode === "standard"
        ? []
        : allocateFlexibleDuties(halls, teacherIds, nextMode);
    save({
      ...p,
      rules: {
        ...p.rules,
        dutyMode: nextMode,
      },
      dutyAssignments: nextAssignments,
    });
  };
  const formatDutyCount = (value: number) =>
    Number.isInteger(value)
      ? String(value)
      : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  const autoAllot = () => {
    if (dutyMode !== "standard") {
      const teacherIds = [...p.teachers]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((teacher) => teacher.id);
      saveAssignments(
        allocateFlexibleDuties(halls, teacherIds, dutyMode),
      );
      return;
    }
    const next: typeof dutyAssignments = [];
    const countsByTeacher = new Map(
      p.teachers.map((teacher) => [teacher.id, [0, 0]]),
    );
    const roomCountsByTeacher = new Map<string, number>();
    const dates = [...new Set(sessions.map((item) => item.date))];
    const previousDateFor = new Map(
      dates.map((date, index) => [date, dates[index - 1]]),
    );
    slots.forEach((slot) => {
      const used = new Set(
        next
          .filter(
            (item) =>
              item.date === slot.date &&
              item.session === slot.session,
          )
          .map((item) => item.teacherId),
      );
      const sessionIndex = /afternoon/i.test(slot.session) ? 1 : 0;
      const teacher = p.teachers
        .filter((item) => !used.has(item.id))
        .sort((a, b) => {
          const aCount = countsByTeacher.get(a.id) ?? [0, 0];
          const bCount = countsByTeacher.get(b.id) ?? [0, 0];
          const aRoomCount =
            roomCountsByTeacher.get(`${a.id}|${slot.room.id}`) ?? 0;
          const bRoomCount =
            roomCountsByTeacher.get(`${b.id}|${slot.room.id}`) ?? 0;
          const previousDate = previousDateFor.get(slot.date);
          const aSameDateRoom = Number(
            next.some(
              (item) =>
                item.teacherId === a.id &&
                item.date === slot.date &&
                item.roomId === slot.room.id,
            ),
          );
          const bSameDateRoom = Number(
            next.some(
              (item) =>
                item.teacherId === b.id &&
                item.date === slot.date &&
                item.roomId === slot.room.id,
            ),
          );
          const aPreviousDateRoom = Number(
            previousDate &&
              next.some(
                (item) =>
                  item.teacherId === a.id &&
                  item.date === previousDate &&
                  item.roomId === slot.room.id,
              ),
          );
          const bPreviousDateRoom = Number(
            previousDate &&
              next.some(
                (item) =>
                  item.teacherId === b.id &&
                  item.date === previousDate &&
                  item.roomId === slot.room.id,
              ),
          );
          return (
            aCount[sessionIndex] - bCount[sessionIndex] ||
            aSameDateRoom - bSameDateRoom ||
            aPreviousDateRoom - bPreviousDateRoom ||
            aCount[0] + aCount[1] - (bCount[0] + bCount[1]) ||
            aRoomCount - bRoomCount ||
            a.name.localeCompare(b.name)
          );
        })[0];
      if (!teacher) return;
      const teacherCounts = countsByTeacher.get(teacher.id)!;
      teacherCounts[sessionIndex] += 1;
      const roomKey = `${teacher.id}|${slot.room.id}`;
      roomCountsByTeacher.set(
        roomKey,
        (roomCountsByTeacher.get(roomKey) ?? 0) + 1,
      );
      next.push({
        date: slot.date,
        session: slot.session,
        roomId: slot.room.id,
        slot: slot.slot,
        teacherId: teacher.id,
      });
    });
    saveAssignments(next);
  };
  const add = () => {
    const name = teacherName.trim();
    if (!name) return;
    update("teachers", [...p.teachers, { id: uid(), name, unavailable: [] }]);
    setTeacherName("");
  };
  return (
    <section className="duty-allotment">
      <aside className="teacher-duty-panel">
        <div className="row">
          <h2>Teachers</h2>
          <span className="badge">{p.teachers.length} teachers</span>
        </div>
        <p className="muted">
          Drag a teacher onto a room duty to assign or replace them.
        </p>
        <div className="teacher-add">
          <input
            value={teacherName}
            placeholder="Teacher name"
            onChange={(event) => setTeacherName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && add()}
          />
          <Button onClick={add}>
            <Plus />
            Add
          </Button>
        </div>
        <div className="teacher-duty-list">
          {p.teachers.map((teacher) => {
            const [forenoon, afternoon] = counts[teacher.id] ?? [0, 0];
            return (
              <article
                key={teacher.id}
                className="teacher-duty-card"
                draggable
                onDragStart={(event) =>
                  event.dataTransfer.setData(
                    "application/x-school-duty",
                    JSON.stringify({ teacherId: teacher.id }),
                  )
                }
              >
                <div>
                  <b>{teacher.name}</b>
                  <button
                    className="danger"
                    onClick={() =>
                      update(
                        "teachers",
                        p.teachers.filter((item) => item.id !== teacher.id),
                      )
                    }
                  >
                    Delete
                  </button>
                </div>
                <small>
                  FN {formatDutyCount(forenoon)} · AN{" "}
                  {formatDutyCount(afternoon)} · Total{" "}
                  {formatDutyCount(forenoon + afternoon)}
                </small>
              </article>
            );
          })}
        </div>
      </aside>
      <section className="panel duty-roster">
        <div className="row">
          <div>
            <h2>Teachers</h2>
            <p className="muted">
              Exam dates, sessions, and rooms come from the current project.
            </p>
          </div>
          <div className="duty-roster-actions">
            <label className="duty-mode-toggle">
              <input
                type="checkbox"
                checked={dutyMode === "half"}
                onChange={(event) =>
                  setDutyMode("half", event.target.checked)
                }
              />
              <span>Half duties</span>
            </label>
            <label className="duty-mode-toggle">
              <input
                type="checkbox"
                checked={dutyMode === "absolute-equal"}
                onChange={(event) =>
                  setDutyMode("absolute-equal", event.target.checked)
                }
              />
              <span>Absolute equal duties</span>
            </label>
            <Button onClick={autoAllot}>Auto allot fairly</Button>
          </div>
        </div>
        {dutyMode === "half" && (
          <p className="duty-mode-note">
            Whole duties are allotted first. Only the remaining halls are
            divided into half duties when equal whole duties are not possible.
          </p>
        )}
        {dutyMode === "absolute-equal" && (
          <p className="duty-mode-note">
            Whole duties are allotted first. Only the remaining hall time is
            divided as needed so every teacher receives exactly the same total.
          </p>
        )}
        {!sessions.length || !rooms.length ? (
          <p className="warning">
            Add active exam timetable sessions and rooms to create the duty
            roster.
          </p>
        ) : (
          sessions.map((item) => (
            <article
              className="duty-session"
              key={`${item.date}|${item.session}`}
            >
              <h3>
                {formatDate(item.date)} · {item.session}
              </h3>
              <div className="duty-room-grid">
                {rooms.map((room) => {
                  const roomSlots = slots.filter(
                    (slot) =>
                      slot.date === item.date &&
                      slot.session === item.session &&
                      slot.room.id === room.id,
                  );
                  return (
                    <div
                      className="duty-room"
                      key={`${item.date}|${item.session}|${room.id}`}
                    >
                      <small>{room.name}</small>
                      <div className="duty-room-teachers">
                        {roomSlots.map((slot) => {
                          const assignment = assignmentFor(slot);
                          const teacher = p.teachers.find(
                            (entry) => entry.id === assignment?.teacherId,
                          );
                          return (
                            <div
                              className="duty-slot"
                              key={slot.key}
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={(event) => {
                                const raw = event.dataTransfer.getData(
                                  "application/x-school-duty",
                                );
                                if (!raw) return;
                                moveOrSwap(slot, JSON.parse(raw));
                              }}
                              onDoubleClick={() =>
                                assignment &&
                                saveAssignments(
                                  dutyAssignments.filter(
                                    (entry) => entry !== assignment,
                                  ),
                                )
                              }
                            >
                              {dutyMode !== "standard" && (
                                <span>
                                  {slot.share === 1
                                    ? "Full duty"
                                    : slot.share === 0.5
                                      ? "Half duty"
                                      : `${formatDutyCount(slot.share * 100)}% duty`}
                                </span>
                              )}
                              <b
                                className={
                                  hasBothSessions(teacher?.id, slot.date)
                                    ? "duty-both-sessions"
                                    : ""
                                }
                                draggable={Boolean(teacher)}
                                onDragStart={(event) =>
                                  teacher &&
                                  event.dataTransfer.setData(
                                    "application/x-school-duty",
                                    JSON.stringify({
                                      teacherId: teacher.id,
                                      sourceKey: slot.key,
                                    }),
                                  )
                                }
                              >
                                {teacher?.name ?? "Drop teacher here"}
                              </b>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          ))
        )}
      </section>
    </section>
  );
}

function candidatesFor(p: Project, date: string, session: string): Candidate[] {
  return p.timetable
    .filter(
      (entry) =>
        entry.date === date &&
        entry.session === session &&
        entry.type !== "none",
    )
    .flatMap((entry) => {
      const group = p.classes.find((item) => item.id === entry.classId);
      if (!group?.active) return [];
      const records = p.students.filter(
        (student) => student.classId === group.id && student.active,
      );
      const source: Student[] = records.length
        ? records
        : Array.from({ length: group.studentCount }, (_, index) => ({
            id: `${group.id}-${index}`,
            roll: `${group.rollPrefix ?? ""}${group.rollStart + index}`,
            classId: group.id,
            active: true,
          }));
      return source.map((student, index) => {
        let language = entry.type === "language" ? student.language : undefined;
        if (entry.type === "language" && !language) {
          const rollNumber =
            Number(student.roll.replace(/\D/g, "")) || group.rollStart + index;
          language = languageForRoll(group.languageRanges, rollNumber);
          if (!language) {
            let count = 0;
            for (const [name, strength] of Object.entries(
              group.languageCounts,
            )) {
              if (index < count + strength) {
                language = name;
                break;
              }
              count += strength;
            }
          }
          language ??= p.languages[0] ?? "Second Language";
        }
        return {
          id: student.id,
          roll: student.roll,
          name: student.name,
          classId: group.id,
          className: group.name,
          subject: language ?? entry.subject,
          language,
        };
      });
    });
}

type SeatingProps = {
  p: Project;
  plan: SeatingPlan | null;
  setPlan: (plan: SeatingPlan) => void;
  duties: ReturnType<typeof allocateDuties>;
  setDuties: (duties: ReturnType<typeof allocateDuties>) => void;
};

function buildSeatingForSession(
  p: Project,
  date: string,
  session: string,
  currentPlan: SeatingPlan | null,
  preserveLocks: boolean,
) {
  const sameSession =
    currentPlan?.date === date && currentPlan.session === session;
  const locked =
    preserveLocks && sameSession
      ? currentPlan.assignments.filter((item) => item.locked)
      : [];
  const protectedSeats =
    preserveLocks && sameSession ? (currentPlan.lockedSeatIds ?? []) : [];
  const nextPlan = generateSeating(
    candidatesFor(p, date, session),
    p.rooms,
    p.rules,
    (currentPlan?.seed ?? 41) + 1,
    locked,
    protectedSeats,
  );
  nextPlan.date = date;
  nextPlan.session = session;
  nextPlan.lockedBenchIds =
    preserveLocks && sameSession ? (currentPlan.lockedBenchIds ?? []) : [];
  return {
    plan: nextPlan,
    duties: allocateDuties(
      p.rooms.filter((room) => room.active).map((room) => room.id),
      p.teachers,
      `${date}|${session}`,
      p.rules.invigilatorsPerRoom,
    ),
  };
}

function Seating({ p, plan, setPlan, duties, setDuties }: SeatingProps) {
  const sessions = useMemo(
    () => [
      ...new Map(
        p.timetable
          .filter((entry) => p.exam.sessions.includes(entry.session))
          .map((entry) => [
            `${entry.date}|${entry.session}`,
            { date: entry.date, session: entry.session },
          ]),
      ).values(),
    ],
    [p.exam.sessions, p.timetable],
  );
  const [selectedKey, setSelectedKey] = useState(
    sessions[0] ? `${sessions[0].date}|${sessions[0].session}` : "",
  );
  useEffect(() => {
    if (
      !sessions.some((item) => `${item.date}|${item.session}` === selectedKey)
    ) {
      setSelectedKey(
        sessions[0] ? `${sessions[0].date}|${sessions[0].session}` : "",
      );
    }
  }, [selectedKey, sessions]);
  const selected =
    sessions.find((item) => `${item.date}|${item.session}` === selectedKey) ??
    sessions[0];
  const candidates = useMemo(
    () => (selected ? candidatesFor(p, selected.date, selected.session) : []),
    [p, selected],
  );
  const seats = roomSeats(p.rooms);
  const run = () => {
    if (!selected) return;
    try {
      const generated = buildSeatingForSession(
        p,
        selected.date,
        selected.session,
        plan,
        Boolean(plan),
      );
      setPlan(generated.plan);
      setDuties(generated.duties);
    } catch (error) {
      alert(
        error instanceof Error ? error.message : "Unable to generate seating",
      );
    }
  };
  return (
    <>
      <section className="panel no-print">
        <div className="row">
          <div>
            <h2>Seating arrangement</h2>
            <p className="muted">
              Candidates are mixed by class and paper, then placed through each
              room in zig-zag order.
            </p>
          </div>
          <Button disabled={!selected} onClick={run}>
            <BookOpen />
            {plan ? "Regenerate unlocked seats" : "Generate seating"}
          </Button>
        </div>
        {sessions.length > 0 && (
          <label className="session-picker">
            Exam session
            <select
              value={selectedKey}
              onChange={(event) => setSelectedKey(event.target.value)}
            >
              {sessions.map((item) => (
                <option
                  key={`${item.date}|${item.session}`}
                  value={`${item.date}|${item.session}`}
                >
                  {formatDate(item.date)} · {item.session}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="capacity">
          <span>
            Candidates <b>{candidates.length}</b>
          </span>
          <span>
            Available seats <b>{seats.length}</b>
          </span>
          <span>
            Remaining <b>{seats.length - candidates.length}</b>
          </span>
        </div>
        {plan && (
          <>
            <p className={plan.conflicts.length ? "warning" : "success"}>
              {plan.conflicts.length
                ? `${plan.conflicts.length} unavoidable paper-proximity conflicts. The valid best-effort arrangement is shown below.`
                : "No same-paper proximity conflicts found."}
            </p>
            {plan.conflicts.length > 0 && (
              <details>
                <summary>Review conflicts</summary>
                <ul>
                  {plan.conflicts.map((conflict, index) => (
                    <li key={`${conflict}-${index}`}>{conflict}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </section>
      {plan && (
        <section className="roomcharts">
          {p.rooms
            .filter((room) => room.active)
            .map((room) => (
              <HallDiagram
                key={room.id}
                room={room}
                p={p}
                plan={plan}
                candidates={candidatesFor(p, plan.date, plan.session)}
                onPlanChange={setPlan}
                editable
              />
            ))}
        </section>
      )}
      {plan && (
        <section className="panel no-print">
          <h2>Invigilation duties</h2>
          <table>
            <thead>
              <tr>
                <th>Room</th>
                <th>Teacher</th>
              </tr>
            </thead>
            <tbody>
              {duties.map((duty, index) => (
                <tr key={`${duty.roomId}-${index}`}>
                  <td>
                    {p.rooms.find((room) => room.id === duty.roomId)?.name}
                  </td>
                  <td>
                    {p.teachers.find((teacher) => teacher.id === duty.teacherId)
                      ?.name ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

function HallDiagram({
  room,
  p,
  plan,
  candidates,
  onPlanChange,
  editable = false,
  printHeader = false,
  printOptions,
}: {
  room: Room;
  p: Project;
  plan: SeatingPlan;
  candidates: Candidate[];
  onPlanChange?: (plan: SeatingPlan) => void;
  editable?: boolean;
  printHeader?: boolean;
  printOptions?: Pick<
    PrintSettings,
    "showSubjects" | "showNames" | "classRollOnly" | "includeEmptySeats"
  >;
}) {
  const roomAssignments = plan.assignments.filter((item) =>
    item.seatId.startsWith(`${room.id}:`),
  );
  const seats = allRoomSeats([{ ...room, active: true }]);
  const disabled = new Set(room.disabled);
  const assignmentFor = (seatId: string) => {
    const candidateId = candidateIdAtSeat(plan.assignments, seatId);
    return candidateId
      ? plan.assignments.find(
          (item) => item.seatId === seatId && item.candidateId === candidateId,
        )
      : undefined;
  };
  const showSubjects = printOptions?.classRollOnly
    ? false
    : (printOptions?.showSubjects ?? true);
  const showNames = printOptions?.classRollOnly
    ? false
    : (printOptions?.showNames ?? false);
  const includeEmptySeats = printOptions?.includeEmptySeats ?? true;
  const isPrintLayout = Boolean(printOptions);
  const updatePlan = (
    assignments: typeof plan.assignments,
    lockedSeatIds = plan.lockedSeatIds ?? [],
    lockedBenchIds = plan.lockedBenchIds ?? [],
  ) =>
    onPlanChange?.({
      ...plan,
      assignments,
      lockedSeatIds,
      lockedBenchIds,
      conflicts: validateSeating(
        assignments,
        candidates,
        roomSeats(p.rooms),
        p.rules,
      ),
    });
  const drop = (target: Seat, candidateId: string) => {
    if (
      !editable ||
      disabled.has(target.id) ||
      (plan.lockedSeatIds ?? []).includes(target.id)
    )
      return;
    const source = plan.assignments.find(
      (item) => item.candidateId === candidateId,
    );
    const targetAssignment = assignmentFor(target.id);
    if (!source || source.locked || targetAssignment?.locked) return;
    const assignments = plan.assignments.filter(
      (item) => item !== source && item !== targetAssignment,
    );
    assignments.push({ ...source, seatId: target.id });
    if (targetAssignment)
      assignments.push({ ...targetAssignment, seatId: source.seatId });
    updatePlan(assignments);
  };
  const toggleSeatLock = (seat: Seat) => {
    const assignment = assignmentFor(seat.id);
    if (assignment)
      updatePlan(
        plan.assignments.map((item) =>
          item === assignment ? { ...item, locked: !item.locked } : item,
        ),
      );
    else {
      const locks = plan.lockedSeatIds ?? [];
      updatePlan(
        plan.assignments,
        locks.includes(seat.id)
          ? locks.filter((id) => id !== seat.id)
          : [...locks, seat.id],
      );
    }
  };
  const toggleBenchLock = (row: number, column: number) => {
    const id = `${room.id}:${row}:${column}`;
    const locks = plan.lockedBenchIds ?? [];
    const lock = !locks.includes(id);
    const benchSeatIds = seats
      .filter((seat) => seat.row === row && seat.column === column)
      .map((seat) => seat.id);
    const assignments = plan.assignments.map((item) =>
      benchSeatIds.includes(item.seatId) ? { ...item, locked: lock } : item,
    );
    const emptyLocks = plan.lockedSeatIds ?? [];
    updatePlan(
      assignments,
      lock
        ? [
            ...new Set([
              ...emptyLocks,
              ...benchSeatIds.filter((seatId) => !assignmentFor(seatId)),
            ]),
          ]
        : emptyLocks.filter((seatId) => !benchSeatIds.includes(seatId)),
      lock ? [...locks, id] : locks.filter((item) => item !== id),
    );
  };
  return (
    <article
      className={`panel hall-plan ${room.columns > 4 ? "wide-room" : "portrait-room"}`}
      data-room={room.name}
    >
      {printHeader && (
        <div className="print-room-header">
          <h2>{p.school.name}</h2>
          <h3>{p.exam.name}</h3>
          <div>
            <span>
              Date: <b>{formatDate(plan.date)}</b>
            </span>
            <span>
              Session: <b>{plan.session}</b>
            </span>
            <span>
              Room: <b>{room.name}</b>
            </span>
            <span>
              Total candidates: <b>{roomAssignments.length}</b>
            </span>
          </div>
        </div>
      )}{" "}
      {!printHeader && (
        <div className="hall-title">
          <h3>{room.name}</h3>
          <span>
            {roomAssignments.length} candidates · {room.rows} × {room.columns}{" "}
            benches
          </span>
        </div>
      )}
      <div className="front-label">FRONT</div>
      <div
        className={`teacher-table ${room.teacherTablePosition ?? "front-center"}`}
      >
        {TEACHER_TABLE_LABEL}
      </div>
      <div className="hall-rows">
        {Array.from({ length: room.rows }, (_, row) => (
          <div className="bench-row" key={row}>
            <div className="row-label">
              <b>ROW {row + 1}</b>
              <span>{row % 2 === 0 ? "→" : "←"}</span>
            </div>
            <div
              className="bench-grid"
              style={{
                gridTemplateColumns: `repeat(${room.columns}, minmax(0, 1fr))`,
              }}
            >
              {physicalBenches(room)
                .filter((bench) => bench.row === row)
                .map(({ column }) => {
                  const id = `${room.id}:${row}:${column}`;
                  const benchLocked = (plan.lockedBenchIds ?? []).includes(id);
                  return (
                    <div
                      className={`bench ${benchLocked ? "locked" : ""}`}
                      key={column}
                    >
                      {(!isPrintLayout || editable) && (
                        <div className="bench-head">
                          <b>BENCH {benchNumber(room, row, column)}</b>
                          {editable && (
                            <button
                              title={
                                benchLocked ? "Unlock bench" : "Lock bench"
                              }
                              onClick={() => toggleBenchLock(row, column)}
                            >
                              {benchLocked ? (
                                <Lock size={12} />
                              ) : (
                                <LockOpen size={12} />
                              )}
                            </button>
                          )}
                        </div>
                      )}
                      <div
                        className="bench-seats"
                        style={{
                          gridTemplateColumns: `repeat(${room.seatsPerBench}, minmax(0, 1fr))`,
                        }}
                      >
                        {seats
                          .filter(
                            (seat) =>
                              seat.row === row && seat.column === column,
                          )
                          .map((seat) => {
                            const assignment = assignmentFor(seat.id);
                            const candidate =
                              assignment &&
                              candidates.find(
                                (item) => item.id === assignment.candidateId,
                              );
                            const locked = Boolean(
                              assignment?.locked ||
                                (plan.lockedSeatIds ?? []).includes(seat.id),
                            );
                            return (
                              <div
                                key={seat.id}
                                className={`seat ${candidate ? "occupied" : ""} ${disabled.has(seat.id) ? "disabled" : ""} ${locked ? "locked" : ""}`}
                                draggable={editable && !!candidate && !locked}
                                onDragStart={(event) =>
                                  candidate &&
                                  event.dataTransfer.setData(
                                    "text/candidate",
                                    candidate.id,
                                  )
                                }
                                onDragOver={(event) =>
                                  editable &&
                                  !disabled.has(seat.id) &&
                                  event.preventDefault()
                                }
                                onDrop={(event) =>
                                  drop(
                                    seat,
                                    event.dataTransfer.getData(
                                      "text/candidate",
                                    ),
                                  )
                                }
                              >
                                {!isPrintLayout && (
                                  <small>Seat {seat.position + 1}</small>
                                )}
                                {disabled.has(seat.id) ? (
                                  <b>DISABLED</b>
                                ) : candidate ? (
                                  <>
                                    <b>
                                      {candidate.className}-{candidate.roll}
                                    </b>
                                    {showNames && candidate.name && (
                                      <span>{candidate.name}</span>
                                    )}
                                    {showSubjects && (
                                      <em>{candidate.subject}</em>
                                    )}
                                  </>
                                ) : includeEmptySeats ? (
                                  <b>EMPTY</b>
                                ) : null}
                                {editable && !disabled.has(seat.id) && (
                                  <button
                                    className="seat-lock"
                                    title={locked ? "Unlock seat" : "Lock seat"}
                                    onClick={() => toggleSeatLock(seat)}
                                  >
                                    {locked ? (
                                      <Lock size={11} />
                                    ) : (
                                      <LockOpen size={11} />
                                    )}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function LegacyReports({
  p,
  plan,
  duties,
  onGenerateSeating,
}: {
  p: Project;
  plan: SeatingPlan | null;
  duties: ReturnType<typeof allocateDuties>;
  onGenerateSeating: () => void;
}) {
  const candidates = plan ? candidatesFor(p, plan.date, plan.session) : [];
  return (
    <>
      <section className="panel report no-print">
        <div className="row">
          <div>
            <h2>Reports & print</h2>
            <p>
              Every room prints as a physical room diagram with its own A4 page.
            </p>
          </div>
          <div className="actions">
            {!plan && (
              <Button onClick={onGenerateSeating}>
                <BookOpen />
                Generate seating
              </Button>
            )}
            <Button disabled={!plan} onClick={() => window.print()}>
              <Printer />
              Print / Save as PDF
            </Button>
          </div>
        </div>
        {!plan ? (
          <p className="warning">
            Generate a seating plan to unlock printable room diagrams.
          </p>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Room</th>
                  <th>Candidates</th>
                  <th>Invigilator</th>
                </tr>
              </thead>
              <tbody>
                {p.rooms
                  .filter((room) => room.active)
                  .map((room) => (
                    <tr key={room.id}>
                      <td>{room.name}</td>
                      <td>
                        {
                          plan.assignments.filter((item) =>
                            item.seatId.startsWith(`${room.id}:`),
                          ).length
                        }
                      </td>
                      <td>
                        {p.teachers.find(
                          (teacher) =>
                            teacher.id ===
                            duties.find((duty) => duty.roomId === room.id)
                              ?.teacherId,
                        )?.name ?? "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </>
        )}
      </section>
      {plan && (
        <section className="print-layout">
          {p.rooms
            .filter((room) => room.active)
            .map((room) => (
              <HallDiagram
                key={room.id}
                room={room}
                p={p}
                plan={plan}
                candidates={candidates}
                printHeader
              />
            ))}
        </section>
      )}
    </>
  );
}
function Reports(props: {
  p: Project;
  plan: SeatingPlan | null;
  duties: ReturnType<typeof allocateDuties>;
  onGenerateSeating: () => void;
  onRegenerateUnlocked: () => void;
  onGeneratePlans: (
    targets: { date: string; session: string }[],
    preserveLocks: boolean,
  ) => SeatingPlan[];
}) {
  if (!props.plan) return <LegacyReports {...props} />;
  return <AdvancedReports {...props} plan={props.plan} />;
}

type PrintDocumentProps = {
  p: Project;
  plan: SeatingPlan;
  plans?: SeatingPlan[];
  duties: ReturnType<typeof allocateDuties>;
  candidates: Candidate[];
  rooms: Room[];
  settings: PrintSettings;
};
function AdvancedReports({
  p,
  plan,
  duties,
  onGeneratePlans,
}: {
  p: Project;
  plan: SeatingPlan;
  duties: ReturnType<typeof allocateDuties>;
  onGenerateSeating: () => void;
  onRegenerateUnlocked: () => void;
  onGeneratePlans: (
    targets: { date: string; session: string }[],
    preserveLocks: boolean,
  ) => SeatingPlan[];
}) {
  const availableSessions = useMemo(
    () => [
      ...new Map(
        p.timetable
          .filter(
            (entry) =>
              entry.type !== "none" && p.exam.sessions.includes(entry.session),
          )
          .map((entry) => [
            `${entry.date}|${entry.session}`,
            { date: entry.date, session: entry.session },
          ]),
      ).values(),
    ].sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.session.localeCompare(b.session),
    ),
    [p.exam.sessions, p.timetable],
  );
  const availableDates = [
    ...new Set(availableSessions.map((item) => item.date)),
  ];
  const [selectedDate, setSelectedDate] = useState(plan.date);
  const [selectedSession, setSelectedSession] = useState(plan.session);
  const [reportPlans, setReportPlans] = useState<SeatingPlan[]>([plan]);
  useEffect(() => {
    setReportPlans((items) => [
      ...items.filter(
        (item) => item.date !== plan.date || item.session !== plan.session,
      ),
      plan,
    ]);
  }, [plan]);
  const sessionsForDate = availableSessions.filter(
    (item) => item.date === selectedDate,
  );
  const targets =
    selectedDate === "ALL"
      ? availableSessions
      : [
          sessionsForDate.find((item) => item.session === selectedSession) ??
            sessionsForDate[0],
        ].filter(
          (item): item is { date: string; session: string } => Boolean(item),
        );
  const selectedPlans = targets
    .map((target) =>
      reportPlans.find(
        (item) =>
          item.date === target.date && item.session === target.session,
      ),
    )
    .filter((item): item is SeatingPlan => Boolean(item));
  const plansReady = targets.length > 0 && selectedPlans.length === targets.length;
  const primaryPlan = selectedPlans[0] ?? plan;
  const candidates = candidatesFor(p, primaryPlan.date, primaryPlan.session);
  const activeRooms = p.rooms.filter((room) => room.active);
  const [selectedRoomIds, setSelectedRoomIds] = useState<string[]>(() =>
    activeRooms.map((room) => room.id),
  );
  const [settings, setSettings] = useState<PrintSettings>(() => {
    try {
      return {
        ...defaultPrintSettings,
        ...JSON.parse(
          localStorage.getItem("school-exams-print-settings") ?? "{}",
        ),
      };
    } catch {
      return defaultPrintSettings;
    }
  });
  useEffect(
    () =>
      localStorage.setItem(
        "school-exams-print-settings",
        JSON.stringify(settings),
      ),
    [settings],
  );
  const rooms = activeRooms.filter((room) => selectedRoomIds.includes(room.id));
  const assignmentCount = selectedPlans.reduce(
    (total, selectedPlan) =>
      total +
      selectedPlan.assignments.filter((assignment) =>
        rooms.some((room) => assignment.seatId.startsWith(`${room.id}:`)),
      ).length,
    0,
  );
  const selectedDuties = duties.filter((duty) =>
    selectedRoomIds.includes(duty.roomId),
  );
  const attendanceDateCount = new Set(
    p.timetable
      .filter((entry) => entry.type !== "none")
      .map((entry) => entry.date)
      .filter(Boolean),
  ).size;
  const baseEstimate = estimatePaper(
    settings,
    rooms,
    assignmentCount,
    selectedDuties.length,
    Math.max(1, attendanceDateCount),
    Math.max(1, p.exam.sessions.length),
  );
  const repeatedPlanCount = Math.max(1, selectedPlans.length);
  const allocationRowCapacity =
    settings.density === "comfortable"
      ? 14
      : settings.density === "compact"
        ? 22
        : 30;
  const questionCountRows = selectedPlans.reduce((total, selectedPlan) => {
    const subjectCount = new Set(
      candidatesFor(p, selectedPlan.date, selectedPlan.session).map(
        (candidate) => candidate.subject,
      ),
    ).size;
    return total + Math.max(1, subjectCount) + 3;
  }, 0);
  const estimateSections = baseEstimate.sections.map((section) => {
    if (section.label === reportLabels.allocation)
      return {
        ...section,
        pages: Math.max(
          1,
          Math.ceil(
            (repeatedPlanCount * (rooms.length + 2)) / allocationRowCapacity,
          ),
        ),
      };
    if (section.label === reportLabels["question-count"])
      return {
        ...section,
        pages: Math.max(
          1,
          Math.ceil(questionCountRows / allocationRowCapacity),
        ),
      };
    if (
      [
        reportLabels.seating,
        reportLabels["class-allocation"],
        reportLabels.labels,
      ].includes(section.label)
    )
      return { ...section, pages: section.pages * repeatedPlanCount };
    return section;
  });
  const estimatedPages = estimateSections.reduce(
    (total, section) => total + section.pages,
    0,
  );
  const estimate = {
    ...baseEstimate,
    sections: estimateSections,
    pages: estimatedPages,
    sheets: settings.duplex
      ? Math.ceil(estimatedPages / 2)
      : estimatedPages,
  };
  const setOption = <K extends keyof PrintSettings>(
    key: K,
    value: PrintSettings[K],
  ) => setSettings((current) => ({ ...current, [key]: value }));
  const toggleRoom = (roomId: string) =>
    setSelectedRoomIds((ids) =>
      ids.includes(roomId)
        ? ids.filter((id) => id !== roomId)
        : [...ids, roomId],
    );
  const generateSelectedPlans = (preserveLocks: boolean) => {
    const generated = onGeneratePlans(targets, preserveLocks);
    if (!generated.length) return;
    setReportPlans((items) => [
      ...items.filter(
        (item) =>
          !generated.some(
            (next) =>
              next.date === item.date && next.session === item.session,
          ),
      ),
      ...generated,
    ]);
  };
  return (
    <>
      <section className="panel report-generator no-print">
        <div className="row">
          <div>
            <h2>Generate PDF / Print</h2>
            <p>
              Create a sharp, paper-saving A4 document from the current seating
              plan.
            </p>
          </div>
          <div className="actions report-generation-actions">
            <Button onClick={() => generateSelectedPlans(false)}>
              <BookOpen />
              Generate seating
            </Button>
            <Button
              className="secondary"
              onClick={() => generateSelectedPlans(true)}
            >
              <LockOpen />
              Regenerate unlocked seats
            </Button>
            <Button
              disabled={!rooms.length || !plansReady}
              onClick={() => window.print()}
            >
              <Printer />
              Generate PDF
            </Button>
          </div>
        </div>
        {!plansReady && (
          <p className="warning">
            Generate seating for the selected date/session before creating the
            PDF.
          </p>
        )}
        <div className="print-config-grid">
          <label>
            Exam date
            <select
              value={selectedDate}
              onChange={(event) => {
                const nextDate = event.target.value;
                setSelectedDate(nextDate);
                if (nextDate !== "ALL") {
                  const firstSession = availableSessions.find(
                    (item) => item.date === nextDate,
                  );
                  if (firstSession) setSelectedSession(firstSession.session);
                }
              }}
            >
              <option value="ALL">ALL</option>
              {availableDates.map((date) => (
                <option key={date} value={date}>
                  {formatDate(date)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Session
            <select
              value={selectedDate === "ALL" ? "ALL" : selectedSession}
              disabled={selectedDate === "ALL"}
              onChange={(event) => setSelectedSession(event.target.value)}
            >
              {selectedDate === "ALL" ? (
                <option value="ALL">ALL</option>
              ) : (
                sessionsForDate.map((item) => (
                  <option key={item.session} value={item.session}>
                    {item.session}
                  </option>
                ))
              )}
            </select>
          </label>
          <label>
            Report type
            <select
              value={settings.reportType}
              onChange={(event) =>
                setOption("reportType", event.target.value as ReportType)
              }
            >
              {Object.entries(reportLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Print density
            <select
              value={settings.density}
              onChange={(event) =>
                setOption(
                  "density",
                  event.target.value as PrintSettings["density"],
                )
              }
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
              <option value="maximum">Maximum paper saving</option>
            </select>
          </label>
          <label>
            Labels per page
            <select
              value={settings.labelsPerPage}
              onChange={(event) =>
                setOption(
                  "labelsPerPage",
                  event.target.value as PrintSettings["labelsPerPage"],
                )
              }
            >
              <option value="auto">Auto</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="4">4</option>
            </select>
          </label>
        </div>
        <fieldset className="room-selector">
          <legend>Rooms</legend>
          <PrintCheckbox
            label="All rooms"
            checked={selectedRoomIds.length === activeRooms.length}
            onChange={(checked) =>
              setSelectedRoomIds(
                checked ? activeRooms.map((room) => room.id) : [],
              )
            }
          />
          {activeRooms.map((room) => (
            <PrintCheckbox
              key={room.id}
              label={room.name}
              checked={selectedRoomIds.includes(room.id)}
              onChange={() => toggleRoom(room.id)}
            />
          ))}
        </fieldset>
        <fieldset className="print-options">
          <legend>Print options</legend>
          <PrintCheckbox
            label="Class-Roll only"
            checked={settings.classRollOnly}
            onChange={(checked) => setOption("classRollOnly", checked)}
          />
          <PrintCheckbox
            label="Show subjects"
            checked={settings.showSubjects}
            disabled={settings.classRollOnly}
            onChange={(checked) => setOption("showSubjects", checked)}
          />
          <PrintCheckbox
            label="Show student names"
            checked={settings.showNames}
            disabled={settings.classRollOnly}
            onChange={(checked) => setOption("showNames", checked)}
          />
          <PrintCheckbox
            label="Include empty seats"
            checked={settings.includeEmptySeats}
            onChange={(checked) => setOption("includeEmptySeats", checked)}
          />
          <PrintCheckbox
            label="Duplex optimized"
            checked={settings.duplex}
            onChange={(checked) => setOption("duplex", checked)}
          />
          {settings.reportType === "combined" && (
            <PrintCheckbox
              label="Include room labels"
              checked={settings.includeLabelsInCombined}
              onChange={(checked) =>
                setOption("includeLabelsInCombined", checked)
              }
            />
          )}
        </fieldset>
        <div className="print-preview-card">
          <div>
            <h3>Print preview</h3>
            <p>
              A4{" "}
              {estimate.orientation === "landscape" ? "Landscape" : "Portrait"}{" "}
              · {settings.density} density
            </p>
          </div>
          <div className="usage-breakdown">
            {estimate.sections.map((section) => (
              <span key={section.label}>
                {section.label} <b>{section.pages} pages</b>
              </span>
            ))}
            <strong>Total: {estimate.pages} pages</strong>
            {settings.duplex && (
              <strong>Estimated physical sheets: {estimate.sheets}</strong>
            )}
          </div>
        </div>
      </section>
      <PrintDocument
        p={p}
        plan={primaryPlan}
        plans={selectedPlans.length ? selectedPlans : [primaryPlan]}
        duties={duties}
        candidates={candidates}
        rooms={rooms}
        settings={settings}
      />
    </>
  );
}

function PrintCheckbox({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={disabled ? "option-disabled" : ""}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}
function PrintDocument(props: PrintDocumentProps) {
  const { settings } = props;
  const plans = props.plans?.length ? props.plans : [props.plan];
  const combinedTypes: Exclude<ReportType, "combined">[] = [
    "allocation",
    "duties",
    "question-count",
    "seating",
    "attendance",
  ];
  const includes = (type: Exclude<ReportType, "combined">) =>
    settings.reportType === type ||
    (settings.reportType === "combined" &&
      (combinedTypes.includes(type) ||
        (type === "labels" && settings.includeLabelsInCombined)));
  return (
    <section
      className={`print-layout density-${settings.density} requested-${settings.orientation}`}
    >
      {includes("allocation") && (
        <AllocationReports {...props} plans={plans} />
      )}
      {includes("question-count") && (
        <QuestionCountReports {...props} plans={plans} />
      )}
      {plans.map((plan) => {
        const sessionProps = {
          ...props,
          plan,
          candidates: candidatesFor(props.p, plan.date, plan.session),
        };
        return (
          <React.Fragment key={`${plan.date}|${plan.session}`}>
            {includes("class-allocation") && (
              <ClassAllocationReport {...sessionProps} />
            )}
            {includes("seating") && <SeatingPrintReport {...sessionProps} />}
            {includes("labels") && <RoomLabelsReport {...sessionProps} />}
          </React.Fragment>
        );
      })}
      {includes("duties") && <DutyReport {...props} />}
      {includes("attendance") && <AttendanceReport {...props} />}
    </section>
  );
}
function CompactPrintHeader({
  p,
  plan,
  title,
  centered = false,
}: {
  p: Project;
  plan: SeatingPlan;
  title: string;
  centered?: boolean;
}) {
  return (
    <div
      className={`compact-print-header${centered ? " centered-report-header" : ""}`}
    >
      <b>{title}</b>
      <span>
        {p.school.name} · {p.exam.name} · {formatDate(plan.date)} · {plan.session}
      </span>
    </div>
  );
}
function PrintPage({
  children,
  settings,
  orientation,
  className = "",
}: {
  children: React.ReactNode;
  settings: PrintSettings;
  orientation?: "portrait" | "landscape";
  className?: string;
}) {
  const actual =
    orientation ??
    (settings.orientation === "landscape" ? "landscape" : "portrait");
  return (
    <article className={`print-page page-${actual} ${className}`}>
      {children}
    </article>
  );
}
function roomCandidates(
  room: Room,
  plan: SeatingPlan,
  candidates: Candidate[],
) {
  return plan.assignments
    .filter((assignment) => assignment.seatId.startsWith(`${room.id}:`))
    .map((assignment) =>
      candidates.find((candidate) => candidate.id === assignment.candidateId),
    )
    .filter((candidate): candidate is Candidate => Boolean(candidate));
}
function compactRanges(items: Candidate[]) {
  const groups = new Map<string, string[]>();
  items.forEach((candidate) =>
    groups.set(candidate.className, [
      ...(groups.get(candidate.className) ?? []),
      candidate.roll,
    ]),
  );
  return [...groups.entries()]
    .map(([name, rawRolls]) => {
      const rolls = rawRolls.sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      );
      return `${name}: ${rolls[0]}–${rolls[rolls.length - 1]}`;
    })
    .join(" · ");
}
function SeatingPrintReport({
  rooms,
  settings,
  p,
  plan,
  candidates,
}: PrintDocumentProps) {
  return (
    <>
      {groupSeatingRooms(rooms, settings.density).map((group) => (
        <PrintPage
          key={group.map((room) => room.id).join("-")}
          settings={settings}
          className={`seating-print-page rooms-${group.length} ${group.some((room) => !isSmallRoom(room)) ? "rooms-stacked" : ""}`}
        >
          <div className="rooms-on-page">
            {group.map((room) => (
              <HallDiagram
                key={room.id}
                room={room}
                p={p}
                plan={plan}
                candidates={candidates}
                printHeader
                printOptions={settings}
              />
            ))}
          </div>
        </PrintPage>
      ))}
    </>
  );
}
function AllocationReports({
  p,
  plans,
  rooms,
  settings,
}: PrintDocumentProps & { plans: SeatingPlan[] }) {
  const rowCapacity =
    settings.density === "comfortable"
      ? 14
      : settings.density === "compact"
        ? 22
        : 30;
  const blocks = plans.flatMap((plan) =>
    Array.from(
      { length: Math.max(1, Math.ceil(rooms.length / rowCapacity)) },
      (_, index) => ({
        plan,
        rooms: rooms.slice(index * rowCapacity, (index + 1) * rowCapacity),
      }),
    ),
  );
  const pages: typeof blocks[] = [];
  for (const block of blocks) {
    const current = pages[pages.length - 1];
    const usedRows = current?.reduce(
      (total, item) => total + item.rooms.length + 2,
      0,
    );
    if (current && usedRows + block.rooms.length + 2 <= rowCapacity)
      current.push(block);
    else pages.push([block]);
  }
  return (
    <>
      {pages.map((page, pageIndex) => (
        <PrintPage key={pageIndex} settings={settings}>
          {page.map((block) => {
            const candidates = candidatesFor(
              p,
              block.plan.date,
              block.plan.session,
            );
            return (
              <section
                className="allocation-report-block"
                key={`${block.plan.date}|${block.plan.session}|${block.rooms[0]?.id ?? "empty"}`}
              >
                <CompactPrintHeader
                  p={p}
                  plan={block.plan}
                  title="Room Allocation"
                />
                <div className="compact-lines">
                  {block.rooms.map((room) => {
                    const items = roomCandidates(room, block.plan, candidates);
                    return (
                      <div key={room.id}>
                        <b>{room.name}</b>
                        <span>{compactRanges(items) || "No candidates"}</span>
                        <strong>Total: {items.length}</strong>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </PrintPage>
      ))}
    </>
  );
}
function LegacyDutyReport({
  p,
  plan,
  rooms,
  duties,
  settings,
}: PrintDocumentProps) {
  return (
    <PrintPage settings={settings}>
      <CompactPrintHeader
        p={p}
        plan={plan}
        title="Teacher Duty List"
        centered
      />
      <table className="print-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Session</th>
            <th>Room</th>
            <th>Teacher</th>
          </tr>
        </thead>
        <tbody>
          {duties
            .filter((duty) => rooms.some((room) => room.id === duty.roomId))
            .map((duty) => (
              <tr key={`${duty.roomId}-${duty.teacherId}`}>
                <td>{formatDate(plan.date)}</td>
                <td>{plan.session}</td>
                <td>{rooms.find((room) => room.id === duty.roomId)?.name}</td>
                <td>
                  {p.teachers.find((teacher) => teacher.id === duty.teacherId)
                    ?.name ?? "—"}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </PrintPage>
  );
}
function DutyReport({ p, plan, rooms, settings }: PrintDocumentProps) {
  const rosterAssignments = p.dutyAssignments ?? [];
  if (!rosterAssignments.length)
    return (
      <LegacyDutyReport
        p={p}
        plan={plan}
        rooms={rooms}
        duties={[]}
        candidates={[]}
        settings={settings}
      />
    );
  const sessions = [
    ...new Map(
      rosterAssignments.map((assignment) => [
        `${assignment.date}|${assignment.session}`,
        { date: assignment.date, session: assignment.session },
      ]),
    ).values(),
  ].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      Number(/afternoon/i.test(a.session)) -
        Number(/afternoon/i.test(b.session)) ||
      a.session.localeCompare(b.session),
  );
  return (
    <PrintPage
      settings={settings}
      orientation={rooms.length > 3 ? "landscape" : "portrait"}
    >
      <CompactPrintHeader
        p={p}
        plan={plan}
        title="Teacher Duty List"
        centered
      />
      <table className="print-table duty-matrix">
        <thead>
          <tr>
            <th>Date</th>
            <th>Session</th>
            {rooms.map((room) => (
              <th key={room.id}>{room.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sessions.map((item, index) => {
            const previous = sessions[index - 1];
            const firstDateRow = previous?.date !== item.date;
            return (
              <tr key={`${item.date}-${item.session}`}>
                <td>{firstDateRow ? formatDate(item.date) : ""}</td>
                <td>{item.session}</td>
                {rooms.map((room) => {
                  const hallAssignments = rosterAssignments
                      .filter(
                        (assignment) =>
                          assignment.date === item.date &&
                          assignment.session === item.session &&
                          assignment.roomId === room.id,
                      )
                      .sort((a, b) => a.slot - b.slot);
                  return (
                    <td key={room.id}>
                      {hallAssignments.length
                        ? hallAssignments.map((assignment) => (
                            <div
                              className="duty-teacher-line"
                              key={`${assignment.slot}-${assignment.teacherId}`}
                            >
                              {
                          p.teachers.find(
                            (teacher) => teacher.id === assignment.teacherId,
                          )?.name ?? "—"
                              }
                            </div>
                          ))
                        : "—"}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </PrintPage>
  );
}

function QuestionCountReports({
  p,
  plans,
  rooms,
  settings,
}: PrintDocumentProps & { plans: SeatingPlan[] }) {
  const rowCapacity =
    settings.density === "comfortable"
      ? 14
      : settings.density === "compact"
        ? 22
        : 30;
  const subjectCapacity = Math.max(1, rowCapacity - 3);
  const blocks = plans.flatMap((plan) => {
    const candidates = candidatesFor(p, plan.date, plan.session);
    const subjects = [
      ...new Set(candidates.map((candidate) => candidate.subject)),
    ];
    const printableSubjects = subjects.length ? subjects : [""];
    return Array.from(
      {
        length: Math.max(
          1,
          Math.ceil(printableSubjects.length / subjectCapacity),
        ),
      },
      (_, index) => ({
        plan,
        candidates,
        subjects: printableSubjects.slice(
          index * subjectCapacity,
          (index + 1) * subjectCapacity,
        ),
        part: index,
      }),
    );
  });
  const pages: typeof blocks[] = [];
  for (const block of blocks) {
    const current = pages[pages.length - 1];
    const usedRows = current?.reduce(
      (total, item) => total + item.subjects.length + 3,
      0,
    );
    if (current && usedRows + block.subjects.length + 3 <= rowCapacity)
      current.push(block);
    else pages.push([block]);
  }
  return (
    <>
      {pages.map((page, pageIndex) => (
        <PrintPage
          key={pageIndex}
          settings={settings}
          orientation={rooms.length > 4 ? "landscape" : "portrait"}
        >
          {page.map((block) => (
            <section
              className="question-count-report-block"
              key={`${block.plan.date}|${block.plan.session}|${block.part}`}
            >
              <CompactPrintHeader
                p={p}
                plan={block.plan}
                title="Question Paper Count"
              />
              <table className="print-table">
                <thead>
                  <tr>
                    <th>Subject</th>
                    {rooms.map((room) => (
                      <th key={room.id}>{room.name}</th>
                    ))}
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {block.subjects.map((subject, subjectIndex) => {
                    const counts = rooms.map(
                      (room) =>
                        roomCandidates(
                          room,
                          block.plan,
                          block.candidates,
                        ).filter((candidate) => candidate.subject === subject)
                          .length,
                    );
                    return (
                      <tr key={subject || subjectIndex}>
                        <td>{subject || "No subjects"}</td>
                        {counts.map((count, index) => (
                          <td key={rooms[index].id}>{count}</td>
                        ))}
                        <td>
                          <b>{counts.reduce((sum, count) => sum + count, 0)}</b>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          ))}
        </PrintPage>
      ))}
    </>
  );
}
function ClassAllocationReport({
  p,
  plan,
  rooms,
  candidates,
  settings,
}: PrintDocumentProps) {
  const classes = [
    ...new Set(candidates.map((candidate) => candidate.className)),
  ];
  return (
    <PrintPage settings={settings}>
      <CompactPrintHeader p={p} plan={plan} title="Class-wise Allocation" />
      <table className="print-table">
        <thead>
          <tr>
            <th>Class</th>
            <th>Room allocation</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {classes.map((className) => {
            const parts = rooms
              .map((room) => ({
                room,
                items: roomCandidates(room, plan, candidates).filter(
                  (candidate) => candidate.className === className,
                ),
              }))
              .filter((part) => part.items.length);
            return (
              <tr key={className}>
                <td>{className}</td>
                <td>
                  {parts
                    .map(
                      (part) =>
                        `${part.room.name}: ${compactRanges(part.items).replace(`${className}: `, "")}`,
                    )
                    .join(" · ")}
                </td>
                <td>
                  {parts.reduce((sum, part) => sum + part.items.length, 0)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </PrintPage>
  );
}
function LegacyAttendanceReport({
  p,
  plan,
  rooms,
  candidates,
  settings,
}: PrintDocumentProps) {
  const rowsPerPage =
    settings.density === "comfortable"
      ? 26
      : settings.density === "compact"
        ? 34
        : 42;
  const pages = rooms.flatMap((room) => {
    const items = roomCandidates(room, plan, candidates);
    return Array.from(
      { length: Math.ceil(items.length / rowsPerPage) },
      (_, pageIndex) => ({
        room,
        pageIndex,
        items: items.slice(
          pageIndex * rowsPerPage,
          (pageIndex + 1) * rowsPerPage,
        ),
      }),
    );
  });
  return (
    <>
      {pages.map(({ room, pageIndex, items }) => (
        <PrintPage
          key={`${room.id}-${pageIndex}`}
          settings={settings}
          className="attendance-page"
        >
          <CompactPrintHeader
            p={p}
            plan={plan}
            title={`Attendance · ${room.name}${pageIndex ? ` · Continued ${pageIndex + 1}` : ""}`}
          />
          <table className="print-table attendance-table">
            <thead>
              <tr>
                <th>No.</th>
                <th>Roll No.</th>
                <th>Name</th>
                <th>Class</th>
                <th>Present / Absent</th>
                <th>Signature</th>
              </tr>
            </thead>
            <tbody>
              {items.map((candidate, index) => (
                <tr key={candidate.id}>
                  <td>{pageIndex * rowsPerPage + index + 1}</td>
                  <td>{candidate.roll}</td>
                  <td>{candidate.name ?? ""}</td>
                  <td>{candidate.className}</td>
                  <td>□ P &nbsp; □ A</td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </PrintPage>
      ))}
    </>
  );
}
function AttendanceReport({
  p,
  plan,
  rooms,
  duties,
  settings,
}: PrintDocumentProps) {
  if (!rooms.length)
    return (
      <LegacyAttendanceReport
        p={p}
        plan={plan}
        rooms={rooms}
        duties={duties}
        candidates={[]}
        settings={settings}
      />
    );
  const dates = [
    ...new Set(
      p.timetable
        .filter((entry) => entry.type !== "none")
        .map((entry) => entry.date)
        .filter(Boolean),
    ),
  ].sort();
  if (!dates.length && plan.date) dates.push(plan.date);
  const sessions = (p.exam.sessions.length
    ? [...p.exam.sessions]
    : [plan.session]
  ).sort(
    (a, b) =>
      (/(^|\s)forenoon\b/i.test(a)
        ? 0
        : /afternoon/i.test(a)
          ? 1
          : 2) -
        (/(^|\s)forenoon\b/i.test(b)
          ? 0
          : /afternoon/i.test(b)
            ? 1
            : 2) || a.localeCompare(b),
  );
  const roomsPerPage =
    settings.density === "comfortable"
      ? 4
      : settings.density === "compact"
        ? 5
        : 6;
  const rowsPerPage =
    settings.density === "comfortable"
      ? 6
      : settings.density === "compact"
        ? 10
        : 12;
  const datesPerPage = Math.max(
    1,
    Math.floor(rowsPerPage / Math.max(1, sessions.length)),
  );
  const roomPages = Array.from(
    { length: Math.ceil(rooms.length / roomsPerPage) },
    (_, index) =>
      rooms.slice(index * roomsPerPage, (index + 1) * roomsPerPage),
  );
  const datePages = Array.from(
    { length: Math.ceil(dates.length / datesPerPage) },
    (_, index) =>
      dates.slice(index * datesPerPage, (index + 1) * datesPerPage),
  );
  const classesForSession = (date: string, session: string) => [
    ...new Set(
      p.timetable
        .filter(
          (entry) =>
            entry.date === date &&
            entry.session === session &&
            entry.type !== "none",
        )
        .map((entry) => {
          const group = p.classes.find((item) => item.id === entry.classId);
          return group
            ? `${group.name}${group.section ? ` ${group.section}` : ""}`
            : "";
        })
        .filter(Boolean),
    ),
  ];
  return (
    <>
      {roomPages.flatMap((pageRooms, roomPageIndex) =>
        datePages.map((pageDates, datePageIndex) => (
          <PrintPage
            key={`${roomPageIndex}-${datePageIndex}`}
            settings={settings}
            orientation="landscape"
            className="attendance-register-page"
          >
            <div className="compact-print-header centered-report-header">
              <b>Exam Absentees Register</b>
              <span>
                {p.school.name} · {p.exam.name}
              </span>
            </div>
            <table className="print-table attendance-register">
              <thead>
                <tr>
                  <th rowSpan={2}>Date</th>
                  <th rowSpan={2}>Session</th>
                  <th colSpan={pageRooms.length}>Absentees</th>
                </tr>
                <tr>
                  {pageRooms.map((room) => (
                    <th key={room.id}>{room.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageDates.flatMap((date) =>
                  sessions.map((session, sessionIndex) => (
                    <tr key={`${date}-${session}`}>
                      {sessionIndex === 0 && (
                        <td rowSpan={sessions.length} className="register-date">
                          {formatDate(date)}
                        </td>
                      )}
                      <td className="register-session">{session}</td>
                      {pageRooms.map((room) => {
                        const classNames = classesForSession(date, session);
                        return (
                          <td className="absence-register-cell" key={room.id}>
                            <div className="absence-class-line">
                              <b>Classes / absent roll numbers:</b>
                            </div>
                            <div className="absence-class-list">
                              {classNames.length ? (
                                classNames.map((className) => (
                                  <div
                                    className="absence-class-entry"
                                    key={className}
                                  >
                                    <span>{className}:</span>
                                  </div>
                                ))
                              ) : (
                                <div className="absence-writing-space" />
                              )}
                            </div>
                            <div className="absence-signature-line">
                              <b>Sign:</b>
                              <span />
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </PrintPage>
        )),
      )}
    </>
  );
}

function RoomLabelsReport({
  p,
  plan,
  rooms,
  candidates,
  settings,
}: PrintDocumentProps) {
  const perPage =
    settings.labelsPerPage === "auto"
      ? settings.density === "comfortable"
        ? 2
        : 4
      : Number(settings.labelsPerPage);
  const pages = Array.from(
    { length: Math.ceil(rooms.length / perPage) },
    (_, index) => rooms.slice(index * perPage, (index + 1) * perPage),
  );
  return (
    <>
      {pages.map((pageRooms, index) => (
        <PrintPage
          key={index}
          settings={settings}
          className={`label-page labels-${perPage}`}
        >
          <div className="room-label-grid">
            {pageRooms.map((room) => {
              const items = roomCandidates(room, plan, candidates);
              return (
                <section className="room-label" key={room.id}>
                  <small>{p.school.name}</small>
                  <h2>{room.name}</h2>
                  <p>{p.exam.name}</p>
                  <b>
                    {formatDate(plan.date)} · {plan.session}
                  </b>
                  <div>{compactRanges(items)}</div>
                  <strong>Total: {items.length}</strong>
                </section>
              );
            })}
          </div>
        </PrintPage>
      ))}
    </>
  );
}

const About = ({
  onBackup,
  onRestore,
}: {
  onBackup: () => void;
  onRestore: () => void;
}) => (
  <section className="panel about">
    <div className="row">
      <h2>School Exams Manager</h2>
      <div className="actions">
        <Button onClick={onBackup}>
          <Download size={16} />
          Backup
        </Button>
        <Button className="secondary" onClick={onRestore}>
          <Upload size={16} />
          Restore backup
        </Button>
      </div>
    </div>
    <p>
      A local-first examination planning system for practical school workflows.
    </p>
    <p>Developed by Jeevan Varghese</p>
    <p className="muted">
      Backup downloads this project as a JSON file. Restore opens a backup and
      saves it back into this browser on this device.
    </p>
    <a
      href="https://itsjeevanvarghese.web.app/"
      target="_blank"
      rel="noreferrer"
    >
      Visit Developer Website
    </a>
    <p className="muted">Version 1.0.0</p>
  </section>
);
const rootHost = globalThis as typeof globalThis & {
  __schoolExamsRoot?: ReturnType<typeof createRoot>;
};
const appRoot =
  rootHost.__schoolExamsRoot ??
  (rootHost.__schoolExamsRoot = createRoot(document.getElementById("root")!));
appRoot.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
