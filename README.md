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

1. Create a Firebase project and enable **Google** in Authentication providers.
2. Create a Firestore database.
3. Firebase web app values are loaded from `.env` (use `.env.example` as the template for another Firebase project).
4. Install Firebase CLI and authenticate: `npm install -g firebase-tools` then `firebase login`.
5. Build and deploy Hosting plus Firestore rules: `npm run build` then `firebase deploy`.

The included `firestore.rules` only permits authenticated users to access documents in `users/{uid}/…`. Sign in with Google and choose **Sync** to upload the current project. Local projects are not uploaded automatically. Use exported JSON backups for portable local projects.

## Production

`npm run build` creates the deployable `dist` directory. Firebase Hosting is configured for React SPA routing on the `school-exams-managerr` site in `firebase.json`.
