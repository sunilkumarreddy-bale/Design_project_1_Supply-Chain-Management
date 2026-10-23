import mongoose, { ClientSession } from 'mongoose';
import { env } from './env';

mongoose.set('strictQuery', true);

export async function connectDB(uri: string = env.mongoUri): Promise<typeof mongoose> {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  return mongoose;
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
}

/**
 * Runs fn inside a MongoDB transaction. Every change that touches more than one
 * stock document goes through here so it commits or rolls back as a unit.
 * Requires a replica set (docker-compose and mongodb-memory-server both provide one).
 */
export async function withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result as T;
  } finally {
    await session.endSession();
  }
}
