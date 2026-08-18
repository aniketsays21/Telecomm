// Domain event types emitted for every state change.
// Every consumer (analytics, webhooks, routing, SLA timers) subscribes to these.

export type DomainEventType =
  | 'conversation.created'
  | 'conversation.assigned'
  | 'conversation.escalated'
  | 'conversation.resolved'
  | 'conversation.snoozed'
  | 'conversation.reopened'
  | 'message.sent'
  | 'message.read'
  | 'contact.created'
  | 'contact.merged'
  | 'agent.online'
  | 'agent.offline'
  | 'sla.breached'
  | 'sla.warning'
  | 'kb.indexed'
  | 'source.synced'
  | 'source.error';

export type DomainEvent<T extends DomainEventType = DomainEventType> = {
  id: string;
  type: T;
  workspaceId: string;
  conversationId?: string;
  actor?: string;
  payload: EventPayload<T>;
  createdAt: string; // ISO-8601
};

type EventPayload<T extends DomainEventType> =
  T extends 'conversation.created' ? { channel: 'chat' | 'email'; contactId: string } :
  T extends 'conversation.assigned' ? { assigneeId: string; previousAssigneeId?: string } :
  T extends 'conversation.escalated' ? { reason: string; confidence?: number } :
  T extends 'conversation.resolved' ? { resolvedBy: 'ai' | 'agent'; csatRating?: number } :
  T extends 'message.sent' ? { messageId: string; authorType: string } :
  T extends 'sla.breached' ? { slaDueAt: string; channel: 'chat' | 'email' } :
  T extends 'source.synced' ? { sourceId: string; docCount: number } :
  Record<string, unknown>;
