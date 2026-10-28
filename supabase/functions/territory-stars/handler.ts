/** Pure HTTP handler; all reward state transitions are one database transaction. */
export interface StarsDependencies {
  webhookSecret: string;
  authenticate(bearer: string): Promise<boolean>;
  callerRpc(bearer: string, name: string, args: Record<string, unknown>): Promise<unknown>;
  serverRpc(name: string, args: Record<string, unknown>): Promise<unknown>;
  telegram(method: string, args: Record<string, unknown>): Promise<unknown>;
}
const uuid = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const validInt = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
function equalSecret(a: string, b: string) {
  if (!a || !b || a.length > 256 || b.length > 256) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
function orderFromPayload(payload: unknown) {
  if (typeof payload !== 'string' || !payload.startsWith('territory:')) return null;
  const id = payload.slice(10); return uuid.test(id) ? id : null;
}
async function boundedBody(request: Request): Promise<string> {
  const advertised = request.headers.get('content-length');
  if (advertised && Number(advertised) > 65536) throw new RangeError('body_too_large');
  const reader = request.body?.getReader();
  if (!reader) return '';
  let size = 0, text = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) { await reader.cancel(); throw new RangeError('body_too_large'); }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}
export function createStarsHandler(deps: StarsDependencies) {
  return async (request: Request): Promise<Response> => {
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: {
      'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info', 'access-control-allow-methods': 'POST,OPTIONS',
    } });
    if (request.method === 'OPTIONS') return reply({});
    if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
    const isWebhook = new URL(request.url).pathname.endsWith('/webhook');
    if (isWebhook && !equalSecret(request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '', deps.webhookSecret)) return reply({ error: 'unauthorized' }, 401);
    try {
      let body: Record<string, unknown> | null;
      try { body = object(JSON.parse(await boundedBody(request))); }
      catch (error) { return reply({ error: error instanceof RangeError ? 'body_too_large' : 'invalid_request' }, error instanceof RangeError ? 413 : 400); }
      if (!body) return reply({ error: 'invalid_request' }, 400);
      if (isWebhook) {
        const query = object(body.pre_checkout_query);
        if (query) {
          const from = object(query.from), id = orderFromPayload(query.invoice_payload);
          const queryId = typeof query.id === 'string' && query.id.length <= 256 ? query.id : '';
          if (!queryId) return reply({ error: 'invalid_precheckout' }, 400);
          let accepted = false;
          if (id && validInt(from?.id) && query.currency === 'XTR' && validInt(query.total_amount)) {
            accepted = await deps.serverRpc('territory_stars_precheckout_v1', { p_order: id, p_telegram: from!.id,
              p_currency: query.currency, p_amount: query.total_amount, p_query: queryId }) === true;
          }
          await deps.telegram('answerPreCheckoutQuery', { pre_checkout_query_id: queryId, ok: accepted,
            ...(!accepted ? { error_message: 'Purchase unavailable. Please reopen the shop.' } : {}) });
          return reply({ ok: true });
        }
        const message = object(body.message), payment = object(message?.successful_payment);
        if (payment) {
          const from = object(message?.from), id = orderFromPayload(payment.invoice_payload);
          if (!id || !validInt(from?.id) || payment.currency !== 'XTR' || !validInt(payment.total_amount) ||
              typeof payment.telegram_payment_charge_id !== 'string' || !payment.telegram_payment_charge_id || payment.telegram_payment_charge_id.length > 256) return reply({ error: 'invalid_payment' }, 400);
          await deps.serverRpc('territory_stars_fulfill_v1', { p_order: id, p_telegram: from!.id,
            p_currency: payment.currency, p_amount: payment.total_amount, p_charge: payment.telegram_payment_charge_id });
          return reply({ ok: true });
        }
        return reply({ ok: true });
      }
      const bearer = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
      if (!bearer || !await deps.authenticate(bearer)) return reply({ error: 'auth_required' }, 401);
      if (body.action === 'catalog') return reply(await deps.callerRpc(bearer, 'territory_stars_catalog_v1', {}));
      if (body.action === 'status' && typeof body.orderId === 'string' && uuid.test(body.orderId)) {
        return reply(await deps.callerRpc(bearer, 'territory_stars_status_v1', { p_order: body.orderId }));
      }
      if (body.action !== 'invoice' || typeof body.sku !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(body.sku) ||
          typeof body.operationId !== 'string' || !uuid.test(body.operationId)) return reply({ error: 'invalid_request' }, 400);
      const order = object(await deps.callerRpc(bearer, 'territory_stars_order_v1', { p_sku: body.sku, p_operation: body.operationId }));
      if (!order || order.currency !== 'XTR' || !validInt(order.amount) || typeof order.orderId !== 'string') throw new Error('invalid_order');
      const link = await deps.telegram('createInvoiceLink', { title: order.title, description: order.description,
        payload: order.payload, provider_token: '', currency: 'XTR', prices: [{ label: order.title, amount: order.amount }] });
      if (typeof link !== 'string' || !/^https:\/\/t\.me\/\$[A-Za-z0-9_-]+$/.test(link)) throw new Error('invalid_invoice_link');
      return reply({ operationId: body.operationId, orderId: order.orderId, invoiceLink: link });
    } catch {
      // A failed fulfillment returns 503 so Telegram retries. No successful-payment loss.
      return reply({ error: 'stars_unavailable' }, 503);
    }
  };
}
