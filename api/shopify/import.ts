import {
  beginShopifyOAuth,
  clearShopifyOAuthCookies,
  createShopifyAdminExecutor,
  ProductionShopifyError,
  requireAuthenticatedShopifyRequest,
  resolveShopifyConnection,
} from '../../server/shopify-production.js';
import { runShopifySyncWithExecutor, type ShopifyImportPeriod } from '../../server/shopify-sync.js';

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
    const body = await request.json().catch(() => ({})) as { period?: unknown; shopifyPageUrl?: unknown; storeDomain?: unknown };
    const period = typeof body.period === 'string' && validPeriods.has(body.period as ShopifyImportPeriod)
      ? body.period as ShopifyImportPeriod
      : null;
    if (!period) return json({ error: 'Choose a valid Shopify import period.', code: 'INVALID_PERIOD' }, 400);
    const shopifyPageUrl = typeof body.shopifyPageUrl === 'string' ? body.shopifyPageUrl.trim() : undefined;
    const storeDomain = shopifyPageUrl || (typeof body.storeDomain === 'string' ? body.storeDomain.trim() : undefined);
    const context = await requireAuthenticatedShopifyRequest(request, storeDomain);

    const connection = await resolveShopifyConnection(request, context);
    if (!connection) {
      const authorization = beginShopifyOAuth(request, context.userId, period, context.storeDomain);
      return json({
        error: 'Connect Shopify once to start importing for this GCS Books user.',
        code: 'SHOPIFY_AUTH_REQUIRED',
        authorizationUrl: authorization.authorizationUrl,
      }, 409, [authorization.setCookie]);
    }

    const runImport = (activeConnection: typeof connection) => runShopifySyncWithExecutor(
      createShopifyAdminExecutor(context.config, activeConnection),
      period,
      activeConnection.storeDomain,
    );
    try {
      const result = await runImport(connection);
      return json(result as unknown as Record<string, unknown>, 200, clearShopifyOAuthCookies(request));
    } catch (error) {
      if (context.config.connectionMode === 'client_credentials' && error instanceof ProductionShopifyError && error.code === 'SHOPIFY_REAUTH_REQUIRED') {
        const refreshedConnection = await resolveShopifyConnection(request, context, { forceRefresh: true });
        if (refreshedConnection) {
          try {
            const result = await runImport(refreshedConnection);
            return json(result as unknown as Record<string, unknown>, 200, clearShopifyOAuthCookies(request));
          } catch (refreshError) {
            if (refreshError instanceof ProductionShopifyError && refreshError.code === 'SHOPIFY_REAUTH_REQUIRED') {
              throw new ProductionShopifyError('Shopify rejected the native server connection. Check the app credentials and approved scopes, then try again.', 502, 'SHOPIFY_CLIENT_CREDENTIALS_FAILED');
            }
            throw refreshError;
          }
        }
      }
      if (context.config.connectionMode === 'client_credentials') throw error;
      if (error instanceof ProductionShopifyError && error.code === 'SHOPIFY_REAUTH_REQUIRED') {
        const authorization = beginShopifyOAuth(request, context.userId, period, context.storeDomain);
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

// Vercel's framework-agnostic Node runtime uses this Web fetch entrypoint.
export default {
  fetch(request: Request) {
    if (request.method === 'POST') return POST(request);
    if (request.method === 'GET') return GET();
    return json({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' }, 405);
  },
};
