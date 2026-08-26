import type { FastifyInstance } from 'fastify';
import { fetchCallNumber, VuFindError } from '../../../services/vufind-service.js';

export async function register(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/modules/bookplate/vufind-call-number',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as { isbn?: string };
      const isbn = (payload.isbn ?? '').trim();
      if (!isbn) {
        return reply.code(400).send({ detail: 'ISBN 不能为空' });
      }
      try {
        const callNumber = await fetchCallNumber(isbn);
        return { call_number: callNumber };
      } catch (err) {
        if (err instanceof VuFindError) {
          return reply.code(502).send({ detail: err.message });
        }
        return reply.code(502).send({ detail: err instanceof Error ? err.message : String(err) });
      }
    }
  );
}