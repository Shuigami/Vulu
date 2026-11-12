import { db } from '#lib/server/app.ts';
import { requireUser } from '#lib/server/guard.ts';
import { userStats } from '#lib/server/stats.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) =>
	userStats(db, requireUser(locals, url).id);
