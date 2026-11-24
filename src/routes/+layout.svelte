<script lang="ts">
	import './layout.css';
	import { installHaptics } from '#lib/haptics.ts';
	import { installRipple } from '#lib/ripple.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
	$effect(() => installRipple());
	$effect(() => installHaptics());
</script>

{@render children()}
