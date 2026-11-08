<script lang="ts">
	// The cookie is read by hooks.server.ts so the next page renders in the right theme.
	function toggle() {
		const root = document.documentElement;
		const current =
			root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
		const next = current === 'dark' ? 'light' : 'dark';
		root.dataset.theme = next;
		document.cookie = `theme=${next}; path=/; max-age=31536000; samesite=lax`;
	}
</script>

<button
	type="button"
	onclick={toggle}
	aria-label="Basculer entre thème clair et sombre"
	title="Thème clair ou sombre"
	class="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full border border-line bg-surface-2 text-ink hover:border-muted"
>
	<svg
		aria-hidden="true"
		width="20"
		height="20"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
	>
		<circle cx="12" cy="12" r="9"></circle>
		<path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"></path>
	</svg>
</button>
