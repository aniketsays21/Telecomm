import { startIngestWorker } from './ingest.js';
import { startEmbedWorker } from './embed.js';
import { startSlaWorker } from './sla.js';

export function startWorkers() {
  const ingest = startIngestWorker();
  const embed = startEmbedWorker();
  const sla = startSlaWorker();
  console.log('[workers] Ingest + Embed + SLA workers started');
  return { ingest, embed, sla };
}
