import { startIngestWorker } from './ingest.js';
import { startEmbedWorker } from './embed.js';
import { startSlaWorker } from './sla.js';
import { startGmailPoller } from './gmail-poll.js';

export function startWorkers() {
  const ingest = startIngestWorker();
  const embed = startEmbedWorker();
  const sla = startSlaWorker();
  const gmail = startGmailPoller();
  console.log('[workers] Ingest + Embed + SLA + Gmail poll workers started');
  return { ingest, embed, sla, gmail };
}
