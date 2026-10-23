import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { env } from '../config/env';
import { loadAuthUser } from '../middleware/auth';
import { idStr } from '../utils/ids';

let io: Server | null = null;

/** Attaches Socket.io to the HTTP server. Clients authenticate with the JWT in the handshake. */
export function initSockets(server: HttpServer): Server {
  io = new Server(server, { cors: { origin: env.clientOrigin, credentials: true } });
  io.use(async (socket, next) => {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ??
        (socket.handshake.headers.authorization ?? '').replace(/^Bearer /, '');
      if (!token) return next(new Error('Authentication required'));
      socket.data.user = await loadAuthUser(token);
      next();
    } catch (e) {
      next(new Error((e as Error).message || 'Authentication failed'));
    }
  });
  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join('all');
    socket.join(`user:${user.id}`);
    if (user.warehouse) socket.join(`wh:${user.warehouse}`);
    if (user.supplier) socket.join(`supplier:${user.supplier}`);
    socket.emit('ready', { userId: user.id, rooms: [...socket.rooms] });
  });
  return io;
}

export function getIO(): Server | null {
  return io;
}

export function closeSockets(): void {
  io?.close();
  io = null;
}

/** Broadcasts to every signed-in client (all clients join the "all" room). */
export function emitAll(event: string, payload: unknown): void {
  io?.to('all').emit(event, payload);
}

/** Warehouse-scoped event: delivered to the "all" room so admins and dashboards see it too. */
export function emitWarehouse(event: string, warehouseId: unknown, payload: Record<string, unknown>): void {
  io?.to('all').emit(event, { warehouse: idStr(warehouseId), ...payload });
}

export function emitUser(userId: unknown, event: string, payload: unknown): void {
  const id = idStr(userId);
  if (id) io?.to(`user:${id}`).emit(event, payload);
}
