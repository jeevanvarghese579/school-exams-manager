# School Exams Manager

A local-first examination administration web app for schools. It manages projects, classes, rooms, timetables, seating plans, invigilation duties and printable reports.

## Features

- Offline Local Only workspaces backed by IndexedDB/Dexie
- Optional Firebase Google sign-in integration and secure user-scoped Firestore layout
- Deterministic physical-seat allocation with proximity-conflict detection
- Capacity validation, second-language candidate grouping, and fair invigilator allocation
- Project backups, print-friendly room allocations and question-paper counts
- Installable PWA with an offline app shell

## Start locally

```bash
npm install
npm run dev
npm test
npm run build
```

## Firebase setup

1. Firebase web app values are loaded from `.env`; use `.env.example` as the variable template and preserve the production app identifiers below.
2. Google sign-in is checked by Firebase Access Manager before any cloud project data is loaded.
3. Cloud projects are stored only under `/apps/schoolExamsManager/users/{uid}/projects/{projectId}`.
4. Build with `npm run build`. If Hosting is intentionally deployed, scope it to this app with `firebase deploy --only hosting:school-exams-managerr`.

Sign in with Google and choose **Sync** to upload the current project. Local projects are not uploaded automatically. Use exported JSON backups for portable local projects.

## Firebase application isolation

This is an existing isolated app.

- Canonical appKey: `schoolExamsManager`
- Firebase Web App ID: `1:379503088311:web:e737a88b7ad8c245133332`
- Hosting site: `school-exams-managerr`

Preserve these identifiers and the existing Firestore data paths. Do not create a new namespace or migrate data unless explicitly requested.

The only authoritative Firestore and Storage rules repository is [school-softwares-firebase-shared-config](https://github.com/jeevanvarghese579/school-softwares-firebase-shared-config). Do not create, replace, or deploy Firestore or Storage rules from this repository, and never run an unscoped `firebase deploy`. If this app needs additional permissions, make the smallest possible change in the canonical shared-rules repository, add emulator coverage, run every existing app rules test and a Firebase dry run, then obtain explicit approval before deployment.

## Production

`npm run build` creates the deployable `dist` directory. Firebase Hosting is configured for React SPA routing on the `school-exams-managerr` site in `firebase.json`.



git add .
git commit -m "pdf fixes v3"
git push
Implemented.
Question Paper Count tables now share available page space.
Additional tables automatically continue onto new PDF pages when needed.
Page-count preview reflects the packed layout.
School and examination names are centered and styled as headings in:Exam Absentees Register
Teacher Duty List




npm run build && firebase deploy && git add . && git commit -m "profile deletion" && git push


new button to add new profile


