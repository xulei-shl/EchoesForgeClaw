import type { FastifyInstance } from 'fastify';
import { getDb } from '../../../config/database.js';
import { DoubanIsbnClient, DOUBAN_BASE_URL } from '../../../services/douban-service.js';
import {
  cachedCoverUrl,
  coverLocalMissing,
  downloadDoubanCover,
  backgroundCoverTask,
  saveManualCover,
} from '../covers.js';
import {
  findBookByIsbn,
  insertBookByIsbn,
  rowToBook,
  updateBookRow,
} from '../../../repositories/index.js';
import { requestAbortSignal, doubanClientConfig, proxyCoverUrl } from '../helpers.js';

export async function register(app: FastifyInstance): Promise<void> {
  // ---- 豆瓣封面代理（公开：<img> 无法携带鉴权头，必须公开） ----
  app.get('/api/modules/bookplate/cover', async (request, reply) => {
    const url = (request.query as { url?: string }).url ?? '';
    let hostname = '';
    try {
      hostname = new URL(url).hostname;
    } catch {
      /* 非法 URL */
    }
    if (!hostname.endsWith('.doubanio.com')) {
      return reply.code(400).send({ detail: 'Only douban image URLs are allowed' });
    }
    const cached = cachedCoverUrl(url);
    if (cached) return reply.redirect(cached);

    const clientConfig = doubanClientConfig();
    const local = await downloadDoubanCover(url, {
      proxy: clientConfig.proxy,
      isDisconnected: async () => requestAbortSignal(request).aborted,
    });
    if (local) return reply.redirect(local);
    return reply.code(502).send({ detail: 'Failed to fetch cover image' });
  });

  // ---- 图书元数据（ISBN → 豆瓣 API，book_cache 持久化缓存） ----
  app.get(
    '/api/modules/bookplate/isbn/:isbn',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = request.params as { isbn: string };
      const isbn = params.isbn;
      const force = (request.query as { force?: string }).force === 'true';
      const db = getDb();
      const clientConfig = doubanClientConfig(db);
      const proxy = clientConfig.proxy ?? '';

      if (requestAbortSignal(request).aborted) {
        return reply.code(499).send({ detail: '客户端已断开连接' });
      }

      // 非强制更新：先查库，命中即返回缓存
      if (!force) {
        const row = findBookByIsbn(db, isbn);
        if (row) {
          const book = rowToBook(row);
          book.isbn = isbn;
          if (book.cover_image && coverLocalMissing(row.coverImageLocal)) {
            // 本地封面缺失：先用代理 URL 兜底展示，同时后台补图回写
            book.cover_image_local = proxyCoverUrl(request, String(book.cover_image));
            void backgroundCoverTask(isbn, String(book.cover_image), proxy);
          }
          return book;
        }
      }

      // 未命中缓存或强制更新：调用豆瓣 API
      const client = new DoubanIsbnClient({ base_url: clientConfig.base_url ?? DOUBAN_BASE_URL, ...clientConfig });
      const book = await client.fetch(isbn);
      if (!book) return reply.code(404).send({ detail: 'Book not found' });

      // 写库：force 覆盖更新；否则以唯一 isbn 查重插入
      const existing = findBookByIsbn(db, isbn);
      if (existing) {
        updateBookRow(db, isbn, book);
      } else {
        insertBookByIsbn(db, isbn);
        updateBookRow(db, isbn, book);
      }

      if (book.cover_image) {
        book.cover_image_local = proxyCoverUrl(request, String(book.cover_image));
        void backgroundCoverTask(isbn, String(book.cover_image), proxy);
      }
      book.isbn = isbn;
      return book;
    }
  );

  // ---- 手动上传封面（自动下载失败时的兜底：落盘 runtime/covers 并回写 book_cache） ----
  app.post(
    '/api/modules/bookplate/isbn/:isbn/cover',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const isbn = (request.params as { isbn: string }).isbn;
      if (!findBookByIsbn(getDb(), isbn)) {
        return reply.code(404).send({ detail: 'book_cache 中不存在该 ISBN 的记录' });
      }
      const data = await request.file();
      if (!data) return reply.code(400).send({ detail: '缺少上传文件（字段名 file）' });
      const bytes = new Uint8Array(await data.toBuffer());
      const local = saveManualCover(isbn, bytes);
      if (!local) {
        return reply.code(400).send({ detail: '仅支持 JPG / PNG / GIF / WebP 图片，且不超过 5MB' });
      }
      return { cover_image_local: local };
    }
  );
}
