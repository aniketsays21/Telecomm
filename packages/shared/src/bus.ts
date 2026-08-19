import IORedis from 'ioredis';
import { DomainEvent, DomainEventType } from './events';

const CHANNEL_PREFIX = 'telecomm:events';

type Handler<T extends DomainEventType = DomainEventType> = (
  event: DomainEvent<T>
) => Promise<void> | void;

export class EventBus {
  private pub: IORedis;
  private sub: IORedis;
  private handlers = new Map<string, Handler[]>();

  constructor(redisUrl: string) {
    this.pub = new IORedis(redisUrl, { lazyConnect: true });
    this.sub = new IORedis(redisUrl, { lazyConnect: true });
  }

  async connect() {
    await Promise.all([this.pub.connect(), this.sub.connect()]);
    this.sub.on('message', (channel: string, message: string) => {
      const event = JSON.parse(message) as DomainEvent;
      const handlers = [
        ...(this.handlers.get(event.type) ?? []),
        ...(this.handlers.get('*') ?? []),
      ];
      for (const h of handlers) h(event);
    });
  }

  async publish<T extends DomainEventType>(event: Omit<DomainEvent<T>, 'id' | 'createdAt'> & { id?: string }) {
    // Spread the caller's fields FIRST so our generated id/createdAt win.
    // The previous order let a spread with an undefined `id` clobber the
    // generated UUID and a missing `createdAt` overwrite the timestamp.
    const full: DomainEvent<T> = {
      ...(event as DomainEvent<T>),
      id: event.id ?? crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    const channel = `${CHANNEL_PREFIX}:${event.workspaceId}`;
    await this.pub.publish(channel, JSON.stringify(full));
    return full;
  }

  subscribe<T extends DomainEventType>(type: T | '*', handler: Handler<T>) {
    const list = this.handlers.get(type) ?? [];
    list.push(handler as Handler);
    this.handlers.set(type, list);
  }

  async subscribeToWorkspace(workspaceId: string) {
    await this.sub.subscribe(`${CHANNEL_PREFIX}:${workspaceId}`);
  }

  async close() {
    await Promise.all([this.pub.quit(), this.sub.quit()]);
  }
}
