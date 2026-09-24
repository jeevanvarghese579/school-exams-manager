import { getAnalytics, isSupported } from "firebase/analytics";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { deleteDoc, getDocs, initializeFirestore, setDoc } from "firebase/firestore";
import type { Project } from "./models";
import { projectDocument, projectsCollection } from "./firebasePaths";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

export const firebaseReady = Boolean(
  config.apiKey && config.authDomain && config.projectId && config.appId,
);

const app = firebaseReady ? initializeApp(config) : undefined;
export const auth = app ? getAuth(app) : undefined;
const store = app
  ? initializeFirestore(app, { ignoreUndefinedProperties: true })
  : undefined;

// Analytics is browser-only and may be unavailable in privacy-focused browsers.
if (app && config.measurementId) {
  void isSupported().then((supported) => {
    if (supported) getAnalytics(app);
  });
}

export const observeAuth = (callback: (user: User | null) => void) =>
  auth ? onAuthStateChanged(auth, callback) : (() => undefined);

export const googleSignIn = () =>
  auth
    ? signInWithPopup(auth, new GoogleAuthProvider())
    : Promise.reject(
        new Error("Firebase is not configured. Add environment variables first."),
      );

export const logOut = () => (auth ? signOut(auth) : Promise.resolve());

export const syncProject = async (uid: string, project: Project) => {
  if (!store) throw new Error("Firebase is unavailable.");
  await setDoc(projectDocument(store, uid, project.id), project);
};

export const deleteCloudProject = async (uid: string, projectId: string) => {
  if (!store) throw new Error("Firebase is unavailable.");
  await deleteDoc(projectDocument(store, uid, projectId));
};

export const loadCloudProjects = async (uid: string): Promise<Project[]> => {
  if (!store) throw new Error("Firebase is unavailable.");
  const snapshot = await getDocs(projectsCollection(store, uid));
  return snapshot.docs.map((projectDocument) => projectDocument.data() as Project);
};
