# spacetimedb-runes

A type-safe, reactive SpacetimeDB client library for Svelte 5, built with runes. This library is based on the React `useTable` implementation provided by SpacetimeDB.

## Features

- **Svelte 5 Runes**: Built from the ground up using Svelte 5's new reactivity system
- **Full Type Safety**: TypeScript support with module augmentation for custom database schemas
- **Reactive Queries**: Automatically updates your UI when database changes occur
- **Type-Safe Where Clauses**: Build complex queries with full autocomplete support
- **Lifecycle Callbacks**: React to inserts, updates, deletes, and initial snapshots
- **Persistent Auth**: Automatic token persistence across sessions

## Installation

```bash
npm install spacetimedb-runes
```

### Peer Dependencies

This library requires:

- `svelte: ^5.0.0`
- `spacetimedb: ^1.8.0` (automatically installed)

## Quick Start

### 1. Set Up Your Connection

First, establish a connection to your SpacetimeDB instance and wrap your app with the `SpacetimeDBContext` component.

#### Example Layout File (`src/routes/+layout.svelte`)

```svelte
<script lang="ts">
  import { SpacetimeDB, SpacetimeDBContext } from 'spacetimedb-runes';
  import { DbConnection } from '@module_bindings';
  import type { Identity } from 'spacetimedb';
  import { onMount } from 'svelte';

  let connection = $state<DbConnection | null>(null);

  onMount(() => {
    const onConnect = (conn: DbConnection, identity: Identity, token: string) => {
      SpacetimeDB.status.set('connected');
      SpacetimeDB.authToken.current = token;

      // Set up reducer callbacks
      conn.reducers.onSendMessage(() => {
        // Message sent callback
      });
    };

    const onDisconnect = () => {
      SpacetimeDB.status.set('disconnected');
    };

    const onConnectError = () => {
      SpacetimeDB.status.set('error');
    };

    const connectionBuilder = DbConnection.builder()
      .withUri('ws://localhost:3000')
      .withModuleName('your-module-name')
      .withToken(SpacetimeDB.authToken.current || undefined)
      .onConnect(onConnect)
      .onDisconnect(onDisconnect)
      .onConnectError(onConnectError);

    // Set status to 'connecting' before building the connection
    // This helps TableQuery properly setup subscriptions when the connection becomes active
    SpacetimeDB.status.set('connecting');
    connection = connectionBuilder.build();
  });

  let status = SpacetimeDB.status;
  let { children } = $props();
</script>

{#if $status === 'connecting'}
  <div class="status-info">Connecting to SpacetimeDB...</div>
{/if}

{#if $status === 'disconnected'}
  <div class="status-warning">
    Disconnected from SpacetimeDB. Are you already connected from another tab?
  </div>
{/if}

{#if $status === 'error'}
  <div class="status-error">
    An error occurred while connecting to SpacetimeDB.
  </div>
{/if}

{#if connection && $status === 'connected'}
  <SpacetimeDBContext {connection}>
    {@render children()}
  </SpacetimeDBContext>
{:else}
  <p>Initializing connection...</p>
{/if}

<style>
  .status-info,
  .status-warning,
  .status-error {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    padding: 0.5rem;
    text-align: center;
    z-index: 1000;
  }

  .status-error {
    background-color: tomato;
    color: white;
  }

  .status-warning {
    background-color: orange;
    color: black;
  }

  .status-info {
    background-color: deepskyblue;
    color: white;
  }
</style>
```

### 2. Query Your Database

Use the `TableQuery` class to subscribe to table changes:

```svelte
<script lang="ts">
  import { TableQuery } from 'spacetimedb-runes';

  const users = new TableQuery('User');
</script>

{#if users.state === 'loading'}
  <p>Loading users...</p>
{:else}
  <ul>
    {#each users.rows as user}
      <li>{user.name}</li>
    {/each}
  </ul>
{/if}
```

## Working Example

For a complete working example of spacetimedb-runes in action, check out this game project: [spacetime-game](https://github.com/SaintPepsi/spacetime-game) (It's based on the [Unreal tutorial for SpacetimeDB](https://spacetimedb.com/docs/unreal))

## Useful SpacetimeDB Commands

Here are some helpful SpacetimeDB CLI commands you can add to your `package.json` scripts:

```json
{
  "scripts": {
    "generate": "spacetime generate --lang typescript --out-dir ./src/module_bindings --project-path ../spacetimedb",
    "compile": "cd ../spacetimedb && spacetime build",
    "publish": "spacetime publish --server local --project-path ../spacetimedb your-module-name"
  }
}
```

- **`generate`** - Generates TypeScript client bindings from your SpacetimeDB module
- **`compile`** - Builds your SpacetimeDB module
- **`publish`** - Publishes your module to a SpacetimeDB server (local or remote)

**Note**: Adjust the paths (`../spacetimedb`, `./src/module_bindings`) and module name (`your-module-name`) to match your project structure.

## Adding Type Safety

To get full type safety and autocomplete for your database schema, you need to augment the `Register` interface using TypeScript's module augmentation. This can be done in your `src/app.d.ts` file or any other `.d.ts` file that TypeScript picks up.

### Example: `src/app.d.ts`

```typescript
import type { DbConnection } from '@module_bindings';

declare global {
  namespace App {
    // ... other App interfaces
  }
}

// Augment the spacetimedb-runes Register interface
declare module 'spacetimedb-runes' {
  interface Register {
    connection: DbConnection;
  }
}

export {};
```

**Important**: Replace `DbConnection` with your actual generated connection type from SpacetimeDB. The `@module_bindings` import should point to your SpacetimeDB generated client code.

### Setting Up the `@module_bindings` Alias

The examples in this README use `@module_bindings` to import SpacetimeDB generated client code. To configure this alias in your SvelteKit project, add it to your [svelte.config.js](svelte.config.js):

```javascript
const config = {
  kit: {
    alias: {
      '@module_bindings': 'src/module_bindings',
      // ... other aliases
    }
  }
};
```

This allows you to import your SpacetimeDB generated types and connection from `@module_bindings` instead of using relative paths.

This enables full autocomplete for:

- Table names in `TableQuery`
- Column names in where clauses
- Row types in callbacks

## Type-Safe Where Clauses

The library provides a callback-based API for building where clauses with **full type safety**:

```svelte
<script lang="ts">
  import { TableQuery } from 'spacetimedb-runes';

  // Filter users where isActive = true
  const activeUsers = new TableQuery('User', ({ where, eq }) =>
    where(eq('isActive', true))
  );

  // Complex queries with AND/OR
  const complexQuery = new TableQuery('User', ({ where, eq, and, or }) =>
    where(
      and(
        eq('role', 'admin'),
        or(
          eq('department', 'Engineering'),
          eq('department', 'Product')
        )
      )
    )
  );
</script>
```

### Where Clause API

The where clause callback receives these helper functions:

- `eq(column, value)` - Equality check (column = value)
- `and(...expressions)` - Logical AND
- `or(...expressions)` - Logical OR
- `where(expression)` - Wraps the final expression

**Type Safety**: Column names are autocompleted based on your table schema, and values are type-checked against the column type.

## Lifecycle Callbacks

TableQuery supports four lifecycle callbacks to react to database changes:

### `onInsert`

Called when a new row is inserted that matches your query:

```svelte
<script lang="ts">
  const users = new TableQuery('User', undefined, {
    onInsert: (row) => {
      console.log('New user added:', row.name);
    }
  });
</script>
```

### `onUpdate`

Called when a row that matches your query is updated:

```svelte
<script lang="ts">
  const users = new TableQuery('User', undefined, {
    onUpdate: (oldRow, newRow) => {
      console.log(`User ${oldRow.name} updated to ${newRow.name}`);
    }
  });
</script>
```

### `onDelete`

Called when a row that matches your query is deleted:

```svelte
<script lang="ts">
  const users = new TableQuery('User', undefined, {
    onDelete: (row) => {
      console.log('User deleted:', row.name);
    }
  });
</script>
```

### `onInitialSnapshot`

**Important**: This callback runs **only once** when the subscription first receives the initial snapshot of existing data from the database.

Use this when you need to perform operations on existing data, since `onInsert`, `onUpdate`, and `onDelete` only fire for **new changes** that occur after the subscription is established.

```svelte
<script lang="ts">
  const users = new TableQuery('User', undefined, {
    onInitialSnapshot: (rows) => {
      console.log(`Loaded ${rows.length} existing users from database`);

      // Example: Initialize local state based on existing data
      const userMap = new Map(rows.map(u => [u.id, u]));
    },
    onInsert: (row) => {
      console.log('NEW user inserted:', row);
    }
  });
</script>
```

**Lifecycle Flow**:

1. `TableQuery` subscribes to the database
2. Database sends initial snapshot → `onInitialSnapshot` fires once
3. Future inserts → `onInsert` fires
4. Future updates → `onUpdate` fires
5. Future deletes → `onDelete` fires

## Advanced Usage

### Filtering with Callbacks

The where clause callbacks ensure type safety while building complex queries:

```svelte
<script lang="ts">
  import { TableQuery } from 'spacetimedb-runes';

  const query = new TableQuery(
    'Task',
    ({ where, eq, and }) => where(
      and(
        eq('status', 'active'),
        eq('assignedTo', currentUserId)
      )
    ),
    {
      onInitialSnapshot: (tasks) => {
        console.log(`You have ${tasks.length} active tasks`);
      },
      onInsert: (task) => {
        showNotification(`New task assigned: ${task.title}`);
      },
      onUpdate: (oldTask, newTask) => {
        if (oldTask.status !== newTask.status) {
          console.log(`Task ${newTask.title} status changed`);
        }
      }
    }
  );
</script>
```

### Manual Cleanup

If you need manual control over the lifecycle, use the `destroy()` method:

```svelte
<script lang="ts">
  import { TableQuery } from 'spacetimedb-runes';
  import { onDestroy } from 'svelte';

  const users = new TableQuery('User');

  onDestroy(() => {
    users.destroy();
  });
</script>
```

## Connection Status

Monitor connection status reactively:

```svelte
<script lang="ts">
  import { SpacetimeDB } from 'spacetimedb-runes';

  let status = SpacetimeDB.status;
</script>

<div>
  Status: {$status}
</div>
```

Status values: `'disconnected'`, `'connecting'`, `'connected'`, `'error'`

## API Reference

### `SpacetimeDB`

Static utilities for managing the SpacetimeDB connection:

- `SpacetimeDB.status` - Writable store tracking connection status
- `SpacetimeDB.authToken` - Persisted state for authentication token
- `SpacetimeDB.getContext<Connection>()` - Retrieve connection from Svelte context
- `SpacetimeDB.setContext(connection)` - Set connection in Svelte context

### `TableQuery<TableName, RowType>`

Reactive class for subscribing to database tables:

**Constructor**:

```typescript
new TableQuery(
  tableName: TableName,
  whereClause?: (helpers) => Expression,
  callbacks?: UseQueryCallbacks<RowType>
)
```

**Properties**:

- `rows: readonly RowType[]` - Reactive array of matching rows
- `state: 'loading' | 'ready'` - Current subscription state

**Methods**:

- `destroy(): void` - Cleanup subscriptions and listeners

### `UseQueryCallbacks<RowType>`

```typescript
interface UseQueryCallbacks<RowType> {
  onInsert?: (row: RowType) => void;
  onDelete?: (row: RowType) => void;
  onUpdate?: (oldRow: RowType, newRow: RowType) => void;
  onInitialSnapshot?: (rows: readonly RowType[]) => void;
}
```

## License

[MIT](LICENSE)

## Credits

Built with [Svelte 5](https://svelte.dev/) and [SpacetimeDB](https://spacetimedb.com/).
