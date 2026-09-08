import {
  beginShopifyOAuth,
  clearShopifyOAuthCookies,
  createShopifyAdminExecutor,
  ProductionShopifyError,
  requireAuthenticatedShopifyRequest,
  resolveShopifyConnection,
} from '../../server/shopify-production';
import { runShopifySyncWithExecutor, type ShopifyImportPeriod } from '../../server/shopify-sync';

export const runtime = 'nodejs';
export const maxDuration = 300;

const validPeriods = new Set<ShopifyImportPeriod>(['last_month', 'last_3_months', 'last_6_months', 'last_1_year', 'lifetime']);

function json(body: Record<string, unknown>, status = 200, cookies: string[] = []) {
  const headers = new Headers({ 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
  cookies.forEach((cookie) => headers.append('Set-Cookie', cookie));
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(error: unknown) {
  if (error instanceof ProductionShopifyError) return json({ error: error.message, code: error.code }, error.statusCode);
  return json({ error: 'Shopify could not be imported right now. Try again in a moment.', code: 'SHOPIFY_IMPORT_FAILED' }, 502);
}

export async function POST(request: Request) {
  try {
    const context = await requireAuthenticatedShopifyRequest(request);
    const body = await request.json().catch(() => ({})) as { period?: unknown };
    const period = typeof body.period === 'string' && validPeriods.has(body.period as ShopifyImportPeriod)
      ? body.period as ShopifyImportPeriod
      : null;
    if (!period) return json({ error: 'Choose a valid Shopify import period.', code: 'INVALID_PERIOD' }, 400);

    const connection = await resolveShopifyConnection(request, context);
    if (!connection) {
      const authorization = beginShopifyOAuth(request, context.userId, period);
      return json({
        error: 'Connect Shopify once to start importing for this GCS Books user.',
        code: 'SHOPIFY_AUTH_REQUIRED',
        authorizationUrl: authorization.authorizationUrl,
      }, 409, [authorization.setCookie]);
    }

    try {
      const result = await runShopifySyncWithExecutor(
        createShopifyAdminExecutor(context.config, connection),
        period,
        connection.storeDomain,
      );
      return json(result as unknown as Record<string, unknown>, 200, clearShopifyOAuthCookies(request));
    } catch (error) {
      if (error instanceof ProductionShopifyError && error.code === 'SHOPIFY_REAUTH_REQUIRED') {
        const authorization = beginShopifyOAuth(request, context.userId, period);
        return json({
          error: error.message,
          code: error.code,
          authorizationUrl: authorization.authorizationUrl,
        }, 409, [...clearShopifyOAuthCookies(request), authorization.setCookie]);
      }
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}

export function GET() {
  return json({ error: 'Use POST /api/shopify/import.', code: 'METHOD_NOT_ALLOWED' }, 405);
}

// Vercel's framework-agnostic Node runtime supports the Web fetch signature.
// Keep the named methods above for local adapters, while also exposing the
// default handler expected by deployments that use the fetch entrypoint.
export default {
  fetch(request: Request) {
    if (request.method === 'POST') return POST(request);
    if (request.method === 'GET') return GET();
    return json({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' }, 405);
  },
};
