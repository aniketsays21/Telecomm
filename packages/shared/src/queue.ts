// Thin wrapper exposing BullMQ queue names so they're consistent across services.
export const QUEUES = {
  INGEST: 'ingest',
  EMBED: 'embed',
  AI_ANSWER: 'ai-answer',
  SUMMARIZE: 'summarize',
  EMAIL_SEND: 'email-send',
  EMAIL_PARSE: 'email-parse',
  ANALYTICS_ROLLUP: 'analytics-rollup',
  SLA_CHECK: 'sla-check',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
