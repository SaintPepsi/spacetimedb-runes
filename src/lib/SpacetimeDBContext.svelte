<script lang="ts">
	import { SpacetimeDB } from '$lib/SpacetimeDB.svelte';
	import type { Connection } from '$lib/types';
	import type { Snippet } from 'svelte';

	let { connection, children }: { connection: Connection; children?: Snippet } = $props();

	$effect(() => {
		SpacetimeDB.setContext(connection);
	});
</script>

{@render children?.()}
