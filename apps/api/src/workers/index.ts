import { startIngestWorker } from './ingest.js';
import { startEmbedWorker } from './embed.js';

export function startWorkers() {
  const ingest = startIngestWorker();
  const embed = startEmbedWorker();
  console.log('[workers] Ingest + Embed workers started');
  return { ingest, embed };
}
