import {
  clearShopifyOAuthCookies,
  completeShopifyOAuth,
  ProductionShopifyError,
} from '../../../server/shopify-production.js';

export const runtime = 'nodejs';
export const maxDuration = 30;

function redirect(target: string, cookies: string[] = []) {
  const headers = new Headers({ Location: target, 'Cache-Control': 'no-store' });
  cookies.forEach((cookie) => headers.append('Set-Cookie', cookie));
  return new Response(null, { status: 303, headers });
}

export async function GET(request: Request) {
  try {
    const result = await completeShopifyOAuth(request);
    return redirect(result.redirectUrl, result.setCookies);
  } catch (error) {
    const target = new URL('/?view=imports&shopify=error', request.url);
    const message = error instanceof ProductionShopifyError
      ? error.message
      : 'Shopify authorization could not be completed. Start the import again.';
    target.searchParams.set('message', message);
    return redirect(target.toString(), clearShopifyOAuthCookies(request));
  }
}

// Expose a default Web handler for Vercel's framework-agnostic Node runtime.
export default function handler(request: Request) {
  return GET(request);
}
