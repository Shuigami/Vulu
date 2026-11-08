// Drizzle translation of docs/schema.sql (source of truth).
// Extensions, f_unaccent() and updated_at triggers live in custom SQL migrations (see drizzle/).
// Column names are camelCase here and snake_case in the database (casing: 'snake_case').
import { sql } from 'drizzle-orm';
import {
	bigint,
	boolean,
	check,
	customType,
	date,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	smallint,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';

const citext = customType<{ data: string }>({ dataType: () => 'citext' });
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

const id = () => bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const mediaRef = () =>
	bigint({ mode: 'number' })
		.notNull()
		.references(() => media.id, { onDelete: 'cascade' });
const userRef = () =>
	uuid()
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' });
const timestamptz = () => timestamp({ withTimezone: true });
const createdAt = () => timestamptz().notNull().defaultNow();
const updatedAt = () => timestamptz().notNull().defaultNow();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export const mediaType = pgEnum('media_type', ['movie', 'tv', 'anime', 'manga', 'book']);
export const releaseStatus = pgEnum('release_status', [
	'announced',
	'releasing',
	'finished',
	'cancelled',
	'hiatus'
]);
export const provider = pgEnum('provider', [
	'tmdb',
	'imdb',
	'tvdb',
	'anilist',
	'mal',
	'mangaupdates',
	'openlibrary',
	'isbn13',
	'google_books',
	'hardcover'
]);
export const entryStatus = pgEnum('entry_status', [
	'planned',
	'in_progress',
	'completed',
	'paused',
	'dropped'
]);
export const eventKind = pgEnum('event_kind', [
	'episode',
	'chapter',
	'volume',
	'pages',
	'started',
	'completed',
	'rated',
	'status_changed'
]);
export const eventSource = pgEnum('event_source', ['manual', 'jellyfin', 'plex', 'import', 'api']);
export const visibility = pgEnum('visibility', ['private', 'unlisted', 'public']);
export const jobStatus = pgEnum('job_status', ['pending', 'running', 'done', 'failed']);

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export const users = pgTable(
	'users',
	{
		id: uuid().primaryKey().defaultRandom(),
		email: citext().notNull().unique('users_email_key'),
		username: citext().notNull().unique('users_username_key'),
		emailVerified: boolean().notNull().default(false),
		displayName: text(), // Better Auth "name"
		avatarUrl: text(), // Better Auth "image"
		locale: text().notNull().default('fr'),
		ratingScale: smallint().notNull().default(10),
		profileVisibility: visibility().notNull().default('private'),
		plan: text().notNull().default('free'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		check('users_username_check', sql`${t.username} ~ '^[a-zA-Z0-9_]{3,30}$'`),
		check('users_rating_scale_check', sql`${t.ratingScale} IN (5, 10, 100)`)
	]
);

// ---------------------------------------------------------------------------
// Authentication (tables used by Better Auth, see src/lib/server/auth)
// ---------------------------------------------------------------------------
export const sessions = pgTable(
	'sessions',
	{
		id: uuid().primaryKey().defaultRandom(),
		userId: userRef(),
		token: text().notNull().unique('sessions_token_key'),
		expiresAt: timestamptz().notNull(),
		ipAddress: text(),
		userAgent: text(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('sessions_user_idx').on(t.userId)]
);

// One row per sign-in method: provider_id 'credential' holds the password hash.
export const accounts = pgTable(
	'accounts',
	{
		id: uuid().primaryKey().defaultRandom(),
		userId: userRef(),
		providerId: text().notNull(),
		accountId: text().notNull(),
		accessToken: text(),
		refreshToken: text(),
		idToken: text(),
		accessTokenExpiresAt: timestamptz(),
		refreshTokenExpiresAt: timestamptz(),
		scope: text(),
		password: text(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		unique('accounts_provider_id_account_id_key').on(t.providerId, t.accountId),
		index('accounts_user_idx').on(t.userId)
	]
);

export const verifications = pgTable(
	'verifications',
	{
		id: uuid().primaryKey().defaultRandom(),
		identifier: text().notNull(),
		value: text().notNull(),
		expiresAt: timestamptz().notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('verifications_identifier_idx').on(t.identifier)]
);

// Beta access: sign-up (password or OAuth) is only allowed for an invited e-mail.
export const invites = pgTable('invites', {
	email: citext().primaryKey(),
	invitedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
	createdAt: createdAt(),
	usedAt: timestamptz()
});

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------
export const media = pgTable(
	'media',
	{
		id: id(),
		type: mediaType().notNull(),
		title: text().notNull(),
		originalTitle: text(),
		overview: text(),
		status: releaseStatus(),
		startDate: date(),
		endDate: date(),
		posterUrl: text(),
		backdropUrl: text(),
		runtimeMinutes: integer(),
		totalUnits: integer(),
		totalUnitsSecondary: integer(),
		isAdult: boolean().notNull().default(false),
		extra: jsonb().$type<Record<string, unknown>>().notNull().default({}),
		lastSyncedAt: timestamptz(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		check('media_total_units_check', sql`${t.totalUnits} >= 0`),
		check('media_total_units_secondary_check', sql`${t.totalUnitsSecondary} >= 0`),
		index('media_type_idx').on(t.type),
		index('media_sync_queue_idx')
			.on(t.lastSyncedAt)
			.where(sql`${t.status} IN ('releasing', 'announced')`)
	]
);

export const mediaExternalIds = pgTable(
	'media_external_ids',
	{
		mediaId: mediaRef(),
		provider: provider().notNull(),
		externalId: text().notNull(),
		isPrimary: boolean().notNull().default(false)
	},
	(t) => [
		primaryKey({ name: 'media_external_ids_pkey', columns: [t.provider, t.externalId] }),
		index('media_external_ids_media_idx').on(t.mediaId),
		uniqueIndex('media_one_primary_source')
			.on(t.mediaId)
			.where(sql`${t.isPrimary}`)
	]
);

export const mediaTitles = pgTable(
	'media_titles',
	{
		id: id(),
		mediaId: mediaRef(),
		title: text().notNull(),
		locale: text()
	},
	(t) => [
		unique('media_titles_media_id_title_key').on(t.mediaId, t.title),
		index('media_titles_trgm_idx').using('gin', sql`f_unaccent(lower(${t.title})) gin_trgm_ops`)
	]
);

export const genres = pgTable('genres', {
	id: integer().primaryKey().generatedAlwaysAsIdentity(),
	slug: text().notNull().unique('genres_slug_key'),
	name: text().notNull()
});

export const mediaGenres = pgTable(
	'media_genres',
	{
		mediaId: mediaRef(),
		genreId: integer()
			.notNull()
			.references(() => genres.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ name: 'media_genres_pkey', columns: [t.mediaId, t.genreId] })]
);

export const seasons = pgTable(
	'seasons',
	{
		id: id(),
		mediaId: mediaRef(),
		number: integer().notNull(), // 0 = specials
		title: text(),
		airDate: date(),
		episodeCount: integer(),
		posterUrl: text()
	},
	(t) => [unique('seasons_media_id_number_key').on(t.mediaId, t.number)]
);

export const episodes = pgTable(
	'episodes',
	{
		id: id(),
		mediaId: mediaRef(),
		seasonId: bigint({ mode: 'number' }).references(() => seasons.id, { onDelete: 'cascade' }),
		number: integer().notNull(),
		absoluteNumber: integer(),
		title: text(),
		airDate: timestamptz(),
		runtimeMinutes: integer()
	},
	(t) => [
		unique('episodes_season_id_number_key').on(t.seasonId, t.number),
		index('episodes_media_idx').on(t.mediaId, t.absoluteNumber),
		index('episodes_calendar_idx').on(t.airDate)
	]
);

// ---------------------------------------------------------------------------
// User library
// ---------------------------------------------------------------------------
export const libraryEntries = pgTable(
	'library_entries',
	{
		id: id(),
		userId: userRef(),
		mediaId: bigint({ mode: 'number' })
			.notNull()
			.references(() => media.id, { onDelete: 'restrict' }),
		status: entryStatus().notNull().default('planned'),
		score: smallint(), // out of 100, displayed in users.rating_scale
		progress: integer().notNull().default(0), // episodes / chapters / pages
		progressSecondary: integer().notNull().default(0), // seasons / volumes
		repeatCount: integer().notNull().default(0),
		startedOn: date(),
		completedOn: date(),
		review: text(),
		notes: text(),
		isFavorite: boolean().notNull().default(false),
		isPrivate: boolean().notNull().default(false),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		check('library_entries_score_check', sql`${t.score} BETWEEN 0 AND 100`),
		check('library_entries_progress_check', sql`${t.progress} >= 0`),
		check('library_entries_progress_secondary_check', sql`${t.progressSecondary} >= 0`),
		unique('library_entries_user_id_media_id_key').on(t.userId, t.mediaId),
		index('library_user_status_idx').on(t.userId, t.status, t.updatedAt.desc().nullsFirst()),
		index('library_media_idx').on(t.mediaId)
	]
);

export const episodeViews = pgTable(
	'episode_views',
	{
		userId: userRef(),
		episodeId: bigint({ mode: 'number' })
			.notNull()
			.references(() => episodes.id, { onDelete: 'cascade' }),
		viewedAt: timestamptz().notNull().defaultNow()
	},
	(t) => [primaryKey({ name: 'episode_views_pkey', columns: [t.userId, t.episodeId, t.viewedAt] })]
);

export const activityEvents = pgTable(
	'activity_events',
	{
		id: id(),
		userId: userRef(),
		mediaId: mediaRef(),
		episodeId: bigint({ mode: 'number' }).references(() => episodes.id, { onDelete: 'set null' }),
		kind: eventKind().notNull(),
		amount: integer(),
		minutes: integer(),
		source: eventSource().notNull().default('manual'),
		occurredAt: timestamptz().notNull().defaultNow(),
		dedupKey: text() // dedups replayed webhooks and imports
	},
	(t) => [
		unique('activity_events_user_id_dedup_key_key').on(t.userId, t.dedupKey),
		index('activity_user_time_idx').on(t.userId, t.occurredAt.desc().nullsFirst())
	]
);

// ---------------------------------------------------------------------------
// Custom lists
// ---------------------------------------------------------------------------
export const lists = pgTable(
	'lists',
	{
		id: id(),
		userId: userRef(),
		name: text().notNull(),
		description: text(),
		visibility: visibility().notNull().default('private'),
		isRanked: boolean().notNull().default(false),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('lists_user_idx').on(t.userId)]
);

export const listItems = pgTable(
	'list_items',
	{
		listId: bigint({ mode: 'number' })
			.notNull()
			.references(() => lists.id, { onDelete: 'cascade' }),
		mediaId: mediaRef(),
		position: integer().notNull(),
		note: text(),
		addedAt: timestamptz().notNull().defaultNow()
	},
	(t) => [primaryKey({ name: 'list_items_pkey', columns: [t.listId, t.mediaId] })]
);

// ---------------------------------------------------------------------------
// Integrations and imports
// ---------------------------------------------------------------------------
export const integrations = pgTable(
	'integrations',
	{
		id: id(),
		userId: userRef(),
		kind: text().notNull(),
		webhookToken: text().unique('integrations_webhook_token_key'),
		credentials: bytea(), // OAuth tokens, encrypted by the application
		settings: jsonb().$type<Record<string, unknown>>().notNull().default({}),
		enabled: boolean().notNull().default(true),
		lastSyncedAt: timestamptz(),
		createdAt: createdAt()
	},
	(t) => [
		check(
			'integrations_kind_check',
			sql`${t.kind} IN ('jellyfin', 'plex', 'anilist', 'mal', 'trakt')`
		),
		unique('integrations_user_id_kind_key').on(t.userId, t.kind)
	]
);

export const importJobs = pgTable(
	'import_jobs',
	{
		id: id(),
		userId: userRef(),
		source: text().notNull(),
		status: jobStatus().notNull().default('pending'),
		stats: jsonb().$type<Record<string, unknown>>().notNull().default({}),
		unmatched: jsonb().$type<unknown[]>().notNull().default([]),
		error: text(),
		createdAt: createdAt(),
		finishedAt: timestamptz()
	},
	(t) => [
		check(
			'import_jobs_source_check',
			sql`${t.source} IN ('trakt', 'anilist', 'mal', 'goodreads', 'storygraph', 'tvtime', 'letterboxd', 'csv')`
		),
		index('import_jobs_user_idx').on(t.userId, t.createdAt.desc().nullsFirst())
	]
);

// ---------------------------------------------------------------------------
// Provider API cache (TMDB, AniList, Open Library), filled by the worker
// ---------------------------------------------------------------------------
export const providerCache = pgTable(
	'provider_cache',
	{
		key: text().primaryKey(), // e.g. 'anilist:media:154587'
		value: jsonb().notNull(),
		expiresAt: timestamptz().notNull()
	},
	(t) => [index('provider_cache_expires_idx').on(t.expiresAt)]
);
