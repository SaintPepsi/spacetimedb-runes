// Reexport your entry components here

import { SpacetimeDB } from '$lib/SpacetimeDB.svelte';
import { TableQuery } from '$lib/TableQuery.svelte';
import SpacetimeDBContext from '$lib/SpacetimeDBContext.svelte';
export type { Register } from '$lib/types';

export { SpacetimeDB, TableQuery, SpacetimeDBContext };
