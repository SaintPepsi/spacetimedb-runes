import type { Connection } from '$lib/types';
import { PersistedState } from 'runed';
import { getContext, setContext } from 'svelte';
import { writable } from 'svelte/store';

export class SpacetimeDB {
	public static status = writable<'disconnected' | 'connecting' | 'connected' | 'error'>(
		'disconnected'
	);

	public static authToken = new PersistedState(
		'spacetimedb_auth_token',
		undefined as string | undefined
	);

	static getContext<DBConnection = Connection>() {
		return getContext<DBConnection>('SpacetimeDB');
	}

	static setContext(connection: Connection) {
		setContext('SpacetimeDB', connection);
	}
}
