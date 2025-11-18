import { SpacetimeDB } from '$lib/SpacetimeDB.svelte';
import type { Connection } from '$lib/types';
import { once } from 'es-toolkit';
import type { TableCache } from 'spacetimedb';
import type { Unsubscriber } from 'svelte/store';

type UseQueryCallbacks<RowType> = {
	onInsert?: (row: RowType) => void;
	onDelete?: (row: RowType) => void;
	onUpdate?: (oldRow: RowType, newRow: RowType) => void;
	onInitialSnapshot?: (rows: readonly RowType[]) => void;
};

type Value = string | number | boolean;

type Expr<Column extends string> =
	| { type: 'eq'; key: Column; value: Value }
	| { type: 'and'; children: Expr<Column>[] }
	| { type: 'or'; children: Expr<Column>[] };

// Query builder helpers (unchanged from React version)
const eq = <Column extends string>(key: Column, value: Value): Expr<Column> => ({
	type: 'eq',
	key,
	value
});

const and = <Column extends string>(...children: Expr<Column>[]): Expr<Column> => {
	const flat: Expr<Column>[] = [];
	for (const c of children) {
		if (!c) continue;
		if (c.type === 'and') flat.push(...c.children);
		else flat.push(c);
	}
	const pruned = flat.filter(Boolean);
	if (pruned.length === 0) return { type: 'and', children: [] };
	if (pruned.length === 1) return pruned[0];
	return { type: 'and', children: pruned };
};

const or = <Column extends string>(...children: Expr<Column>[]): Expr<Column> => {
	const flat: Expr<Column>[] = [];
	for (const c of children) {
		if (!c) continue;
		if (c.type === 'or') flat.push(...c.children);
		else flat.push(c);
	}
	const pruned = flat.filter(Boolean);
	if (pruned.length === 0) return { type: 'or', children: [] };
	if (pruned.length === 1) return pruned[0];
	return { type: 'or', children: pruned };
};

// Evaluation and formatting functions (unchanged)
function evaluate<Column extends string>(
	expr: Expr<Column>,
	row: Record<Column, unknown>
): boolean {
	switch (expr.type) {
		case 'eq': {
			const v = row[expr.key];
			if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
				return v === expr.value;
			}
			return false;
		}
		case 'and':
			return expr.children.length === 0 || expr.children.every((c) => evaluate(c, row));
		case 'or':
			return expr.children.length !== 0 && expr.children.some((c) => evaluate(c, row));
	}
}

function formatValue(v: Value): string {
	switch (typeof v) {
		case 'string':
			return `'${v.replace(/'/g, "''")}'`;
		case 'number':
			return Number.isFinite(v) ? String(v) : `'${String(v)}'`;
		case 'boolean':
			return v ? 'TRUE' : 'FALSE';
	}
}

function escapeIdent(id: string): string {
	if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) return id;
	return `"${id.replace(/"/g, '""')}"`;
}

function parenthesize(s: string): string {
	if (!s.includes(' AND ') && !s.includes(' OR ')) return s;
	return `(${s})`;
}

function toString<Column extends string>(expr: Expr<Column>): string {
	switch (expr.type) {
		case 'eq':
			return `${escapeIdent(expr.key)} = ${formatValue(expr.value)}`;
		case 'and':
			return parenthesize(expr.children.map(toString).join(' AND '));
		case 'or':
			return parenthesize(expr.children.map(toString).join(' OR '));
	}
}

function where<Column extends string>(expr: Expr<Column>): Expr<Column> {
	return expr;
}

type MembershipChange = 'enter' | 'leave' | 'stayIn' | 'stayOut';

function classifyMembership<Col extends string, R extends Record<string, unknown>>(
	where: Expr<Col> | undefined,
	oldRow: R,
	newRow: R
): MembershipChange {
	if (!where) {
		return 'stayIn';
	}

	const oldIn = evaluate(where, oldRow);
	const newIn = evaluate(where, newRow);

	if (oldIn && !newIn) return 'leave';
	if (!oldIn && newIn) return 'enter';
	if (oldIn && newIn) return 'stayIn';
	return 'stayOut';
}

type ColumnsFromRow<R> = {
	[K in keyof R]-?: R[K] extends Value | undefined ? K : never;
}[keyof R] &
	string;

type RowTypes<TableName extends keyof Connection['db']> = Parameters<
	Connection['db'][TableName]['tableCache']['update']
>[2];

type WhereClauseCallbackParameters<Column extends string> = {
	where(expr: Expr<Column>): Expr<Column>;
	eq(key: Column, value: Value): Expr<Column>;
	and(...children: Expr<Column>[]): Expr<Column>;
	or(...children: Expr<Column>[]): Expr<Column>;
};

type WhereClauseCallback<RowType> = (
	params: WhereClauseCallbackParameters<ColumnsFromRow<RowType>>
) => Expr<ColumnsFromRow<RowType>>;

/**
 * Svelte 5 rune class for subscribing to SpacetimeDB tables with reactive updates.
 *
 * Unlike React hooks which are functions called on every render, this is a class
 * that maintains its own reactive state using Svelte 5's signal system.
 *
 * @example
 * ```svelte
 * <script>
 *   const userTable = new TableQuery('users', ({ where, eq }) => where(eq('isActive', true)), {
 *     onInsert: (row) => console.log('Inserted:', row),
 *     onDelete: (row) => console.log('Deleted:', row),
 *     onUpdate: (oldRow, newRow) => console.log('Updated:', oldRow, newRow),
 * 	   onInitialSnapshot: (rows) => console.log('Initial snapshot:', rows)
 *   });
 * </script>
 *
 * {#if userTable.state === 'loading'}
 *   <p>Loading...</p>
 * {:else}
 *   {#each userTable.rows as user}
 *     <div>{user.name}</div>
 *   {/each}
 * {/if}
 * ```
 */
export class TableQuery<
	TableName extends keyof Connection['db'],
	RowType extends RowTypes<TableName>
> {
	// Reactive state using $state rune
	#rows = $state<readonly RowType[]>([]);
	#subscribeApplied = $state<boolean>(false);

	// Non-reactive internal state
	#client: Connection;
	#tableName: TableName;
	#whereClause: Expr<ColumnsFromRow<RowType>> | undefined;
	#callbacks: UseQueryCallbacks<RowType> | undefined;
	#query: string;
	#initialSnapshotHandler: UseQueryCallbacks<RowType>['onInitialSnapshot'];
	#latestTransactionEvent: any = null;
	#unsubscribe: (() => void) | null = null;
	#tableUnSubscribers: Array<() => void> = [];

	constructor(
		tableName: TableName,
		whereClause?: WhereClauseCallback<RowType>,
		callbacks?: UseQueryCallbacks<RowType>
	) {
		this.#client = SpacetimeDB.getContext<Connection>();
		this.#tableName = tableName;
		this.#whereClause = whereClause ? whereClause({ where, eq, and, or }) : undefined;
		this.#callbacks = callbacks;

		this.#query =
			`SELECT * FROM ${tableName as string}` +
			(this.#whereClause ? ` WHERE ${toString(this.#whereClause)}` : '');

		// Initialize subscription in constructor

		this.#initialSnapshotHandler = callbacks?.onInitialSnapshot
			? once(callbacks?.onInitialSnapshot)
			: () => void 0;
		let unsubscribeStatus: Unsubscriber;

		const handleStatusChange = (status: 'disconnected' | 'connecting' | 'connected' | 'error') => {
			// console.log('Status changed:', status, tableName);
			if (status !== 'connected') return;
			this.#setupSubscription();

			if (unsubscribeStatus) {
				// console.log('Unsubscribing from status changes');
				unsubscribeStatus();
				this.#tableUnSubscribers = this.#tableUnSubscribers.filter(
					(fn) => fn !== unsubscribeStatus
				);
			}

			unsubscribeStatus?.();
		};

		unsubscribeStatus = SpacetimeDB.status.subscribe(handleStatusChange);

		this.#tableUnSubscribers.push(unsubscribeStatus);
		// console.log('spacetime status subscribed');
	}

	/**
	 * Reactive getter for rows - automatically tracks dependencies
	 * When accessed in a $derived or template, Svelte knows to re-render
	 */
	get rows(): readonly RowType[] {
		return this.#rows;
	}

	/**
	 * Reactive getter for subscription state
	 */
	get state(): 'loading' | 'ready' {
		return this.#subscribeApplied ? 'ready' : 'loading';
	}

	/**
	 * Compute the current snapshot from the table cache
	 * This method is NOT reactive - it's called when we need to update state
	 */
	#computeSnapshot(): readonly RowType[] {
		const table = this.#client.db[
			this.#tableName as keyof Connection['db']
		] as unknown as TableCache<RowType>;

		if (this.#whereClause) {
			return table.iter().filter((row) => evaluate(this.#whereClause!, row));
		}
		return table.iter();
	}

	/**
	 * Update reactive state - this triggers Svelte's reactivity
	 */
	#updateSnapshot(): void {
		// Use untrack to prevent infinite loops if computeSnapshot accesses reactive state
		this.#rows = this.#computeSnapshot();
		this.#initialSnapshotHandler?.(this.#rows);
	}

	#setupSubscription(): void {
		if (!this.#client.isActive) {
			// If client becomes active later, you might want to use $effect to watch this
			return;
		}

		// Subscribe to the SpacetimeDB query
		const cancel = this.#client
			.subscriptionBuilder()
			.onApplied(() => {
				this.#subscribeApplied = true;
				this.#updateSnapshot();
			})
			.subscribe(this.#query);

		this.#unsubscribe = () => {
			cancel.unsubscribe();
		};

		// Set up table event listeners
		this.#setupTableListeners();
	}

	#setupTableListeners(): void {
		const table = this.#client.db[
			this.#tableName as keyof Connection['db']
		] as unknown as TableCache<RowType>;

		const onInsert = (ctx: any, row: RowType) => {
			if (this.#whereClause && !evaluate(this.#whereClause, row)) {
				return;
			}

			this.#callbacks?.onInsert?.(row);

			// Only update snapshot once per transaction event
			if (ctx.event !== this.#latestTransactionEvent || !this.#latestTransactionEvent) {
				this.#latestTransactionEvent = ctx.event;
				this.#updateSnapshot();
			}
		};

		const onDelete = (ctx: any, row: RowType) => {
			if (this.#whereClause && !evaluate(this.#whereClause, row)) {
				return;
			}

			this.#callbacks?.onDelete?.(row);

			if (ctx.event !== this.#latestTransactionEvent || !this.#latestTransactionEvent) {
				this.#latestTransactionEvent = ctx.event;
				this.#updateSnapshot();
			}
		};

		const onUpdate = (ctx: any, oldRow: RowType, newRow: RowType) => {
			const change = classifyMembership(this.#whereClause, oldRow, newRow);

			switch (change) {
				case 'leave':
					this.#callbacks?.onDelete?.(oldRow);
					break;
				case 'enter':
					this.#callbacks?.onInsert?.(newRow);
					break;
				case 'stayIn':
					this.#callbacks?.onUpdate?.(oldRow, newRow);
					break;
				case 'stayOut':
					return; // no-op
			}

			if (ctx.event !== this.#latestTransactionEvent || !this.#latestTransactionEvent) {
				this.#latestTransactionEvent = ctx.event;
				this.#updateSnapshot();
			}
		};

		table.onInsert(onInsert);
		table.onDelete(onDelete);
		table.onUpdate?.(onUpdate);

		// Store cleanup functions
		this.#tableUnSubscribers.push(
			() => table.removeOnInsert(onInsert),
			() => table.removeOnDelete(onDelete),
			() => table.removeOnUpdate?.(onUpdate)
		);
	}

	/**
	 * Manual cleanup method - call this when the component unmounts
	 * In Svelte 5, you'd typically use this with $effect cleanup
	 */
	destroy(): void {
		this.#unsubscribe?.();
		this.#tableUnSubscribers.forEach((unsubscribe) => unsubscribe());
		this.#tableUnSubscribers = [];
	}
}
