import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { db } from '@telecomm/db';
import { conversations } from '@telecomm/db/schema';

const STARS = ['', '★', '★★', '★★★', '★★★★', '★★★★★'];
const LABELS = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'];

function thankYouPage(rating: number) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Thanks for your feedback</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           display: flex; align-items: center; justify-content: center;
           min-height: 100vh; margin: 0; background: #f9fafb; }
    .card { background: #fff; border-radius: 16px; padding: 48px 40px;
            text-align: center; max-width: 400px; box-shadow: 0 4px 24px rgba(0,0,0,.06); }
    .stars { font-size: 40px; color: #f59e0b; margin-bottom: 16px; }
    h1 { font-size: 22px; font-weight: 700; color: #111827; margin: 0 0 8px; }
    p  { font-size: 15px; color: #6b7280; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="stars">${STARS[rating]}</div>
    <h1>Thanks for your feedback!</h1>
    <p>You rated your experience: <strong>${LABELS[rating]}</strong>.<br>
       We appreciate you taking the time to respond.</p>
  </div>
</body>
</html>`;
}

export async function csatRoutes(app: FastifyInstance) {
  // GET /csat/:conversationId/rate?rating=1-5
  // Public link — clicked from the CSAT email. Records rating and shows a thank-you page.
  app.get<{
    Params: { conversationId: string };
    Querystring: { rating?: string; comment?: string };
  }>('/csat/:conversationId/rate', async (request, reply) => {
    const { conversationId } = request.params;
    const rating = Number(request.query.rating);
    const comment = (request.query.comment ?? '').trim();

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return reply
        .code(400)
        .type('text/html')
        .send('<p>Invalid rating. Please click one of the star links in the email.</p>');
    }

    const [conv] = await db
      .select({ id: conversations.id, csatRating: conversations.csatRating })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);

    if (!conv) {
      return reply.code(404).type('text/html').send('<p>Conversation not found.</p>');
    }

    // Only record the first rating (don't allow overwrite)
    if (conv.csatRating === null) {
      await db
        .update(conversations)
        .set({
          csatRating: rating,
          csatComment: comment || null,
        } as any)
        .where(eq(conversations.id, conversationId));
    }

    return reply.type('text/html').send(thankYouPage(rating));
  });
}
