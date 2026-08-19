import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { verifySession } from '../../lib/token.js';

// Workspace-keyed rooms: workspaceId → Set of open WebSocket connections
const rooms = new Map<string, Set<WebSocket>>();

export function broadcastToWorkspace(workspaceId: string, data: unknown) {
  const room = rooms.get(workspaceId);
  if (!room) return;
  const payload = JSON.stringify(data);
  for (const ws of room) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
    }
  }
}

export async function wsRoutes(app: FastifyInstance) {
  await app.register(import('@fastify/websocket'));

  app.get('/ws', { websocket: true }, async (socket: WebSocket, request: FastifyRequest) => {
    const token = (request.query as Record<string, string>).token;
    let workspaceId: string | null = null;

    // Authenticate via query-string token (cannot use Authorization header on WS)
    try {
      const session = await verifySession(token);
      workspaceId = session.workspaceId;
    } catch {
      socket.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
      socket.close(1008, 'Unauthorized');
      return;
    }

    // Join room
    if (!rooms.has(workspaceId)) rooms.set(workspaceId, new Set());
    rooms.get(workspaceId)!.add(socket);

    socket.send(JSON.stringify({ type: 'connected', workspaceId }));

    socket.on('close', () => {
      const room = rooms.get(workspaceId!);
      if (room) {
        room.delete(socket);
        if (room.size === 0) rooms.delete(workspaceId!);
      }
    });

    socket.on('error', () => {
      const room = rooms.get(workspaceId ?? '');
      room?.delete(socket);
    });
  });
}
