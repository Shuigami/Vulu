import { error } from '@sveltejs/kit';
import { db } from '#lib/server/app.ts';
import { entriesCsv, exportData } from '#lib/server/export.ts';
import { isMediaType } from '#lib/labels.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) error(401);
	const { format } = params;
	if (format !== 'json' && format !== 'csv') error(404);
	const t = url.searchParams.get('type');
	const type = isMediaType(t) ? t : undefined;
	const data = await exportData(db, locals.user.id, type);
	const name = ['vulu', data.user.username, type, data.exportedAt.slice(0, 10)]
		.filter(Boolean)
		.join('-');
	return new Response(
		format === 'json' ? JSON.stringify(data, null, 2) : entriesCsv(data.entries),
		{
			headers: {
				'content-type':
					format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8',
				'content-disposition': `attachment; filename="${name}.${format}"`
			}
		}
	);
};
