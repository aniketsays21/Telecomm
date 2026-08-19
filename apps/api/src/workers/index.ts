import { startIngestWorker } from './ingest.js';
import { startSlaWorker } from './sla.js';
import { startGmailPoller } from './gmail-poll.js';

export function startWorkers() {
  const ingest = startIngestWorker();
  const sla = startSlaWorker();
  const gmail = startGmailPoller();
  console.log('[workers] Ingest + SLA + Gmail poll workers started');
  return { ingest, sla, gmail };
}
