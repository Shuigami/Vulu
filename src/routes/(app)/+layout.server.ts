import type { LayoutServerLoad } from './$types';

// Browsing is open to signed-out visitors; personal pages and actions call requireUser.
export const load: LayoutServerLoad = ({ locals }) => ({
	user: locals.user && {
		// Always set: the sign-up hook picks one (src/lib/server/auth)
		username: locals.user.username!,
		displayName: locals.user.name,
		avatarUrl: locals.user.image ?? null
	},
	ratingScale: locals.user?.ratingScale ?? 5
});
