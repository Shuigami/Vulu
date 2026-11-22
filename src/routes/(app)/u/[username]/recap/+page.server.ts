import { error } from '@sveltejs/kit';
import { dev } from '$app/env';
import { db } from '#lib/server/app.ts';
import { viewerId as viewerOf } from '#lib/server/guard.ts';
import {
	RECAP_RELEASE,
	RECAP_YEAR,
	recapOpen,
	recapOwner,
	releaseLabel,
	yearRecap
} from '#lib/server/recap.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, url }) => {
	const viewerId = viewerOf(locals);
	const user = await recapOwner(db, params.username, viewerId);
	if (!user) error(404, 'Profil introuvable');
	// `?apercu` opens it early in development only, to work on the page
	const preview = dev && url.searchParams.has('apercu');
	const open = recapOpen() || preview;
	return {
		owner: {
			username: user.username,
			name: user.displayName || user.username,
			avatarUrl: user.avatarUrl
		},
		isSelf: user.id === viewerId,
		year: RECAP_YEAR,
		release: RECAP_RELEASE.toISOString(),
		releaseLabel: releaseLabel(),
		preview,
		// Before the release nothing is computed, so nothing can leak into the page
		recap: open ? await yearRecap(db, user.id, viewerId) : null
	};
};
