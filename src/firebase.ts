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
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  initializeFirestore,
  setDoc,
} from "firebase/firestore";
import type { Project } from "./models";
import { getFunctions, httpsCallable } from "firebase/functions";

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

export const app = firebaseReady ? initializeApp(config) : undefined;
export const auth = app ? getAuth(app) : undefined;
const functions = app ? getFunctions(app, "us-central1") : undefined;
const store = app
  ? initializeFirestore(app, { ignoreUndefinedProperties: true })
  : undefined;

// Analytics is browser-only and may be unavailable in privacy-focused browsers.
if (app && config.measurementId) {
  void isSupported().then((supported) => {
    if (supported) getAnalytics(app);
  });
}

const requireAppAccess = async (user: User) => {
  if (!functions || !config.appId) throw new Error("Firebase Access Manager is not configured.");
  const result = await httpsCallable(functions, "checkMyAccess")({ appId: config.appId });
  const data = result.data && typeof result.data === "object" ? result.data as { allowed?: boolean } : {};
  if (data.allowed !== true) {
    throw new Error("Your account is not approved for School Exams Manager. Contact the administrator for access.");
  }
  return user;
};

export const observeAuth = (callback: (user: User | null) => void) =>
  auth ? onAuthStateChanged(auth, async (user) => {
    if (!user) {
      callback(null);
      return;
    }
    try {
      callback(await requireAppAccess(user));
    } catch (error) {
      console.error("[School Exams Auth] Access denied", error);
      await signOut(auth);
      callback(null);
    }
  }) : (() => undefined);

export const googleSignIn = async () => {
  if (!auth) throw new Error("Firebase is not configured. Add environment variables first.");
  const credential = await signInWithPopup(auth, new GoogleAuthProvider());
  try {
    await requireAppAccess(credential.user);
    return credential;
  } catch (error) {
    await signOut(auth);
    throw error;
  }
};

export const logOut = () => (auth ? signOut(auth) : Promise.resolve());

export const syncProject = async (uid: string, project: Project) => {
  if (!store) throw new Error("Firebase is unavailable.");
  await setDoc(doc(store, "apps", "schoolExamsManager", "users", uid, "projects", project.id), project);
};

export const deleteCloudProject = async (uid: string, projectId: string) => {
  if (!store) throw new Error("Firebase is unavailable.");
  await deleteDoc(doc(store, "apps", "schoolExamsManager", "users", uid, "projects", projectId));
};

export const loadCloudProjects = async (uid: string): Promise<Project[]> => {
  if (!store) throw new Error("Firebase is unavailable.");
  const snapshot = await getDocs(collection(store, "apps", "schoolExamsManager", "users", uid, "projects"));
  return snapshot.docs.map((projectDocument) => projectDocument.data() as Project);
};
