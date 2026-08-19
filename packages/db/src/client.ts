import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';

const connectionString = process.env.DATABASE_URL!;

// For migrations and scripts, use a single connection
export const migrationClient = postgres(connectionString, { max: 1 });

// For app use, use a pool
const queryClient = postgres(connectionString);
export const db = drizzle(queryClient, { schema });

export type Db = typeof db;
