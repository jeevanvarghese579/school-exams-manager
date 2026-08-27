import Dexie, { type Table } from 'dexie'; import type { Project, SeatingPlan } from './models';
class ExamsDB extends Dexie { projects!: Table<Project, string>; plans!: Table<SeatingPlan, string>; constructor(){ super('school-exams-manager'); this.version(1).stores({ projects: 'id,updatedAt,archived', plans: 'id,date,session' }); } }
export const db = new ExamsDB();
export const saveProject = async (p: Project) => db.projects.put({ ...p, updatedAt: Date.now() });
