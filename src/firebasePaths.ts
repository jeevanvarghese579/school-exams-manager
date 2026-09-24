import { collection, doc, type Firestore } from 'firebase/firestore';

export const APP_KEY = 'schoolExamsManager' as const;

export const projectsCollection = (store: Firestore, uid: string) =>
  collection(store, 'apps', APP_KEY, 'users', uid, 'projects');

export const projectDocument = (store: Firestore, uid: string, projectId: string) =>
  doc(store, 'apps', APP_KEY, 'users', uid, 'projects', projectId);

