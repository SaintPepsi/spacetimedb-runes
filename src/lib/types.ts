import type { DbConnectionImpl } from 'spacetimedb';

/**
 * Register interface that can be augmented via module declaration.
 * This allows users to provide their custom DbConnection type for full type safety.
 *
 * @example
 * ```typescript
 * // In your app.d.ts or types file
 * declare module 'spacetimedb-runes' {
 *   interface Register {
 *     connection: YourCustomDbConnection;
 *   }
 * }
 * ```
 */
export interface Register {
	// connection: YourCustomDbConnection
}

/**
 * Resolved connection type - uses the registered connection if provided,
 * otherwise falls back to the base DbConnectionImpl
 */
export type Connection = Register extends { connection: infer T } ? T : DbConnectionImpl;
