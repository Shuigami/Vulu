/// <reference lib="webworker" />
// App shell only: built code and static files are cached, pages and data never are (they are
// personal). A page that cannot load offline gets static/offline.html.
import { version } from '$app/env';
import { assets, immutable } from '$app/manifest';
import { self } from '$app/service-worker';

const CACHE = `vulu-${version}`;
const OFFLINE = 'offline.html';
// Manifest paths are relative to the base path, which is the worker's scope
const url = (path: string) => new URL(path, self.registration.scope).href;
const shell = new Set([...immutable, ...assets].map(({ path }) => url(path)));

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll([...shell]))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;
	const href = request.url.split('#')[0];
	if (shell.has(href)) {
		event.respondWith(caches.match(href).then((hit) => hit ?? fetch(request)));
	} else if (request.mode === 'navigate') {
		event.respondWith(
			fetch(request).catch(async () => (await caches.match(url(OFFLINE))) ?? Response.error())
		);
	}
});
