import { db } from '#lib/server/app.ts';
import { userStats } from '#lib/server/stats.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => userStats(db, locals.user!.id);
