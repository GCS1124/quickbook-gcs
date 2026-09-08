import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  normalizeStoreDomain,
  normalizeShopifyStoreInput,
  type GraphQLResponse,
  type JsonRecord,
  type ShopifyImportPeriod,
  type ShopifyQueryExecutor,
} from './shopify-sync.js';

const DEFAULT_API_VERSION = '2026-07';
const DEFAULT_SCOPES = 'read_orders,read_all_orders,read_products,read_inventory,read_shopify_payments_accounts,read_shopify_payments_payouts';
const OAUTH_STATE_COOKIE = 'gcs-books-shopify-oauth-state';
const PENDING_CONNECTION_COOKIE = 'gcs-books-shopify-pending';
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const CLIENT_CREDENTIALS_REFRESH_BUFFER_MS = 60 * 1000;
const CLIENT_CREDENTIALS_FALLBACK_TTL_MS = 23 * 60 * 60 * 1000;

export type ShopifyConnectionMode = 'oauth' | 'client_credentials';

export class ProductionShopifyError extends Error {
  constructor(
    message: string,
    readonly statusCode = 502,
    readonly code = 'SHOPIFY_IMPORT_FAILED',
  ) {
    super(message);
    this.name = 'ProductionShopifyError';
  }
}

export type ProductionShopifyConfig = {
  storeDomain: string | null;
  allowedStoreDomains: string[];
  apiVersion: string;
  scopes: string;
  connectionMode: ShopifyConnectionMode;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenEncryptionSecret: string;
  oauthStateSecret: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
};

export type AuthenticatedShopifyRequest = {
  accessToken: string;
  userId: string;
  storeDomain: string | null;
  config: ProductionShopifyConfig;
  supabase: SupabaseClient;
};

export type ShopifyConnection = {
  storeDomain: string;
  accessToken: string;
  scope: string | null;
  expiresAt: number | null;
};

type OAuthState = {
  userId: string;
  storeDomain: string;
  period: ShopifyImportPeriod;
  nonce: string;
  expiresAt: number;
};

type PendingConnection = {
  userId: string;
  storeDomain: string;
  accessToken: string;
  scope: string | null;
  tokenExpiresAt: number | null;
  expiresAt: number;
};

type StoredConnection = {
  store_domain: string;
  access_token_ciphertext: string;
  scope: string | null;
};

const envValue = (name: string) => String(process.env[name] || '').trim();

function missingConfig(names: string[]) {
  if (!names.length) return;
  throw new ProductionShopifyError(
    `Production Shopify import is not configured. Add ${names.join(', ')} to the server environment, then redeploy.`,
    503,
    'SHOPIFY_NOT_CONFIGURED',
  );
}

export function getProductionShopifyConfig(request?: Request): ProductionShopifyConfig {
  const supabaseUrl = envValue('VITE_SUPABASE_URL') || envValue('NEXT_PUBLIC_SUPABASE_URL');
  const supabasePublishableKey = envValue('VITE_SUPABASE_PUBLISHABLE_KEY') || envValue('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  const connectionModeValue = envValue('SHOPIFY_CONNECTION_MODE').toLowerCase() || 'oauth';
  const storeDomainValue = envValue('SHOPIFY_STORE_DOMAIN');
  const allowedStoreDomainValues = [storeDomainValue, ...envValue('SHOPIFY_ALLOWED_STORE_DOMAINS').split(',')]
    .map((value) => value.trim())
    .filter(Boolean);
  const clientId = envValue('SHOPIFY_APP_CLIENT_ID');
  const clientSecret = envValue('SHOPIFY_APP_CLIENT_SECRET');
  const tokenEncryptionSecret = envValue('SHOPIFY_TOKEN_ENCRYPTION_KEY');
  const oauthStateSecret = envValue('SHOPIFY_OAUTH_STATE_SECRET');
  const redirectUri = envValue('SHOPIFY_APP_REDIRECT_URI') || (request ? new URL('/api/shopify/oauth/callback', request.url).toString() : '');
  if (connectionModeValue !== 'oauth' && connectionModeValue !== 'client_credentials') {
    throw new ProductionShopifyError(
      'SHOPIFY_CONNECTION_MODE must be oauth or client_credentials.',
      503,
      'SHOPIFY_NOT_CONFIGURED',
    );
  }
  const connectionMode = connectionModeValue as ShopifyConnectionMode;
  missingConfig([
    ...(!supabaseUrl ? ['VITE_SUPABASE_URL'] : []),
    ...(!supabasePublishableKey ? ['VITE_SUPABASE_PUBLISHABLE_KEY'] : []),
    ...(connectionMode === 'client_credentials' && !allowedStoreDomainValues.length ? ['SHOPIFY_STORE_DOMAIN or SHOPIFY_ALLOWED_STORE_DOMAINS'] : []),
    ...(!clientId ? ['SHOPIFY_APP_CLIENT_ID'] : []),
    ...(!clientSecret ? ['SHOPIFY_APP_CLIENT_SECRET'] : []),
    ...(!tokenEncryptionSecret ? ['SHOPIFY_TOKEN_ENCRYPTION_KEY'] : []),
    ...(connectionMode === 'oauth' && !oauthStateSecret ? ['SHOPIFY_OAUTH_STATE_SECRET'] : []),
    ...(connectionMode === 'oauth' && !redirectUri ? ['SHOPIFY_APP_REDIRECT_URI'] : []),
  ]);

  let allowedStoreDomains: string[];
  try {
    allowedStoreDomains = [...new Set(allowedStoreDomainValues.map((value) => normalizeStoreDomain(value)))];
  } catch {
    throw new ProductionShopifyError('SHOPIFY_STORE_DOMAIN and SHOPIFY_ALLOWED_STORE_DOMAINS must contain valid store.myshopify.com domains.', 503, 'SHOPIFY_NOT_CONFIGURED');
  }
  const storeDomain = allowedStoreDomains[0] || null;

  return {
    storeDomain,
    allowedStoreDomains,
    apiVersion: envValue('SHOPIFY_API_VERSION') || DEFAULT_API_VERSION,
    scopes: envValue('SHOPIFY_OAUTH_SCOPES') || DEFAULT_SCOPES,
    connectionMode,
    clientId,
    clientSecret,
    redirectUri,
    tokenEncryptionSecret,
    oauthStateSecret,
    supabaseUrl,
    supabasePublishableKey,
  };
}

function bearerToken(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export async function requireAuthenticatedShopifyRequest(request: Request, storeInput?: string): Promise<AuthenticatedShopifyRequest> {
  const accessToken = bearerToken(request);
  if (!accessToken) throw new ProductionShopifyError('Sign in to import from Shopify.', 401, 'AUTH_REQUIRED');
  const config = getProductionShopifyConfig(request);
  const supabase = createSupabaseClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data: { user }, error } = await supabase.auth.getUser(accessToken);
  if (error || !user) throw new ProductionShopifyError('Your Supabase session is no longer valid. Sign in again and retry the Shopify import.', 401, 'AUTH_REQUIRED');
  let storeDomain = config.storeDomain;
  if (storeInput) {
    try {
      storeDomain = normalizeShopifyStoreInput(storeInput);
    } catch {
      throw new ProductionShopifyError('Paste the canonical store.myshopify.com domain from Shopify Settings > Domains. Shopify admin URL aliases are not always the API domain.', 400, 'SHOPIFY_STORE_INVALID');
    }
    if (config.connectionMode === 'client_credentials' && !config.allowedStoreDomains.includes(storeDomain)) {
      throw new ProductionShopifyError('That Shopify store is not enabled for this native server connection.', 403, 'SHOPIFY_STORE_NOT_ALLOWED');
    }
  }
  return { accessToken, userId: user.id, storeDomain, config, supabase };
}

function base64Url(value: Uint8Array | string) {
  return Buffer.from(value).toString('base64url');
}

function fromBase64Url(value: string) {
  return Buffer.from(value, 'base64url');
}

function encryptionKey(secret: string) {
  return createHash('sha256').update(secret).digest();
}

function encryptJson(value: unknown, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return `${base64Url(iv)}.${base64Url(cipher.getAuthTag())}.${base64Url(ciphertext)}`;
}

function decryptJson<T>(value: string, secret: string): T {
  const [ivText, tagText, ciphertextText] = value.split('.');
  if (!ivText || !tagText || !ciphertextText) throw new Error('The encrypted Shopify connection is malformed.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), fromBase64Url(ivText));
  decipher.setAuthTag(fromBase64Url(tagText));
  const plaintext = Buffer.concat([decipher.update(fromBase64Url(ciphertextText)), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext) as T;
}

function signState(state: OAuthState, secret: string) {
  const payload = base64Url(JSON.stringify(state));
  const signature = base64Url(createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${signature}`;
}

function verifyState(value: string, secret: string): OAuthState {
  const [payload, signature] = value.split('.');
  if (!payload || !signature) throw new ProductionShopifyError('The Shopify authorization session is invalid. Start the import again.', 400, 'SHOPIFY_AUTH_INVALID');
  const expected = createHmac('sha256', secret).update(payload).digest();
  const actual = fromBase64Url(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new ProductionShopifyError('The Shopify authorization session is invalid. Start the import again.', 400, 'SHOPIFY_AUTH_INVALID');
  }
  let state: OAuthState;
  try {
    state = JSON.parse(fromBase64Url(payload).toString('utf8')) as OAuthState;
  } catch {
    throw new ProductionShopifyError('The Shopify authorization session is invalid. Start the import again.', 400, 'SHOPIFY_AUTH_INVALID');
  }
  if (!state.userId || !state.storeDomain || !state.nonce || !state.expiresAt || state.expiresAt < Date.now()) {
    throw new ProductionShopifyError('The Shopify authorization session expired. Start the import again.', 400, 'SHOPIFY_AUTH_EXPIRED');
  }
  return state;
}

function parseCookies(request: Request) {
  const cookies = new Map<string, string>();
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) {
      try { cookies.set(name, decodeURIComponent(value)); } catch { /* ignore malformed cookies */ }
    }
  }
  return cookies;
}

function cookieHeader(name: string, value: string, request: Request, maxAge = OAUTH_STATE_TTL_SECONDS) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearShopifyOAuthCookies(request: Request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return [
    `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
    `${PENDING_CONNECTION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  ];
}

export function beginShopifyOAuth(request: Request, userId: string, period: ShopifyImportPeriod, storeDomainOverride?: string | null) {
  const config = getProductionShopifyConfig(request);
  const storeDomain = storeDomainOverride || config.storeDomain;
  if (!storeDomain) throw new ProductionShopifyError('Choose your Shopify store before starting the import.', 400, 'SHOPIFY_STORE_REQUIRED');
  const state = signState({
    userId,
    storeDomain,
    period,
    nonce: base64Url(randomBytes(18)),
    expiresAt: Date.now() + OAUTH_STATE_TTL_SECONDS * 1000,
  }, config.oauthStateSecret);
  const authorizationUrl = new URL(`https://${storeDomain}/admin/oauth/authorize`);
  authorizationUrl.searchParams.set('client_id', config.clientId);
  authorizationUrl.searchParams.set('scope', config.scopes);
  authorizationUrl.searchParams.set('redirect_uri', config.redirectUri);
  authorizationUrl.searchParams.set('state', state);
  return {
    authorizationUrl: authorizationUrl.toString(),
    setCookie: cookieHeader(OAUTH_STATE_COOKIE, state, request),
  };
}

function verifyShopifyHmac(url: URL, secret: string) {
  const provided = url.searchParams.get('hmac');
  if (!provided) throw new ProductionShopifyError('Shopify did not return a valid authorization signature.', 400, 'SHOPIFY_AUTH_INVALID');
  const message = [...url.searchParams.entries()]
    .filter(([key]) => key !== 'hmac')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  const expected = createHmac('sha256', secret).update(message).digest('hex');
  const actual = Buffer.from(provided, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (actual.length !== expectedBuffer.length || !timingSafeEqual(actual, expectedBuffer)) {
    throw new ProductionShopifyError('Shopify authorization could not be verified. Start the import again.', 400, 'SHOPIFY_AUTH_INVALID');
  }
}

async function exchangeAuthorizationCode(config: ProductionShopifyConfig, code: string, storeDomain: string) {
  let response: Response;
  try {
    response = await fetch(`https://${storeDomain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, expiring: '0' }),
    });
  } catch {
    throw new ProductionShopifyError('Shopify could not be reached during authorization. Try the import again.', 502, 'SHOPIFY_AUTH_FAILED');
  }
  const payload = await response.json().catch(() => ({})) as { access_token?: unknown; scope?: unknown; error?: unknown; error_description?: unknown };
  if (!response.ok || typeof payload.access_token !== 'string' || !payload.access_token) {
    throw new ProductionShopifyError('Shopify did not approve this connection. Check the requested permissions and try again.', 502, 'SHOPIFY_AUTH_FAILED');
  }
  return { accessToken: payload.access_token, scope: typeof payload.scope === 'string' ? payload.scope : null };
}

async function exchangeClientCredentials(config: ProductionShopifyConfig, storeDomain: string) {
  let response: Response;
  try {
    response = await fetch(`https://${storeDomain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    });
  } catch {
    throw new ProductionShopifyError('Shopify could not be reached while creating the native server connection. Try the import again.', 502, 'SHOPIFY_CLIENT_CREDENTIALS_FAILED');
  }
  const payload = await response.json().catch(() => ({})) as {
    access_token?: unknown;
    expires_in?: unknown;
    scope?: unknown;
  };
  const expiresInSeconds = Number(payload.expires_in);
  if (!response.ok || typeof payload.access_token !== 'string' || !payload.access_token) {
    throw new ProductionShopifyError('Shopify native server connection could not be created. Check the store domain, app credentials, and approved scopes, then try again.', 502, 'SHOPIFY_CLIENT_CREDENTIALS_FAILED');
  }
  return {
    accessToken: payload.access_token,
    scope: typeof payload.scope === 'string' ? payload.scope : null,
    expiresAt: Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
      ? Date.now() + expiresInSeconds * 1000
      : Date.now() + CLIENT_CREDENTIALS_FALLBACK_TTL_MS,
  };
}

export async function completeShopifyOAuth(request: Request) {
  const url = new URL(request.url);
  const config = getProductionShopifyConfig(request);
  const stateCookie = parseCookies(request).get(OAUTH_STATE_COOKIE);
  const stateValue = url.searchParams.get('state');
  if (!stateCookie || !stateValue || stateCookie !== stateValue) {
    throw new ProductionShopifyError('The Shopify authorization session is missing or expired. Start the import again.', 400, 'SHOPIFY_AUTH_EXPIRED');
  }
  const state = verifyState(stateValue, config.oauthStateSecret);
  const shopValue = url.searchParams.get('shop') || '';
  let storeDomain: string;
  try {
    storeDomain = normalizeStoreDomain(shopValue);
  } catch {
    throw new ProductionShopifyError('Shopify returned an invalid store domain.', 400, 'SHOPIFY_AUTH_INVALID');
  }
  if (storeDomain !== state.storeDomain || (config.storeDomain !== null && storeDomain !== config.storeDomain)) {
    throw new ProductionShopifyError('The Shopify store does not match this GCS Books connection.', 400, 'SHOPIFY_AUTH_INVALID');
  }
  if (url.searchParams.get('error')) throw new ProductionShopifyError('Shopify authorization was cancelled. Start the import again when you are ready.', 400, 'SHOPIFY_AUTH_CANCELLED');
  verifyShopifyHmac(url, config.clientSecret);
  const code = url.searchParams.get('code');
  if (!code) throw new ProductionShopifyError('Shopify did not return an authorization code.', 400, 'SHOPIFY_AUTH_INVALID');
  const token = await exchangeAuthorizationCode(config, code, storeDomain);
  const pending: PendingConnection = {
    userId: state.userId,
    storeDomain,
    accessToken: token.accessToken,
    scope: token.scope,
    tokenExpiresAt: null,
    expiresAt: Date.now() + OAUTH_STATE_TTL_SECONDS * 1000,
  };
  const redirectUrl = new URL('/?view=imports&shopify=connected', config.redirectUri);
  redirectUrl.searchParams.set('period', state.period);
  return {
    redirectUrl: redirectUrl.toString(),
    setCookies: [
      cookieHeader(PENDING_CONNECTION_COOKIE, encryptJson(pending, config.tokenEncryptionSecret), request),
      ...clearShopifyOAuthCookies(request).slice(0, 1),
    ],
  };
}

async function readStoredConnection(context: AuthenticatedShopifyRequest): Promise<ShopifyConnection | null> {
  const result = await context.supabase
    .from('finance_shopify_connections')
    .select('store_domain, access_token_ciphertext, scope')
    .eq('user_id', context.userId)
    .maybeSingle();
  if (result.error) {
    if (result.error.code === '42P01' || result.error.code === 'PGRST205') {
      throw new ProductionShopifyError('The production Shopify connection table is not installed in Supabase yet. Apply the latest database migration, then redeploy.', 503, 'SHOPIFY_DATABASE_NOT_READY');
    }
    throw new ProductionShopifyError('GCS Books could not read your Shopify connection. Check Supabase and try again.', 503, 'SHOPIFY_DATABASE_NOT_READY');
  }
  if (!result.data) return null;
  const stored = result.data as StoredConnection;
  try {
    const token = decryptJson<{ accessToken?: unknown; expiresAt?: unknown }>(stored.access_token_ciphertext, context.config.tokenEncryptionSecret);
    if (typeof token.accessToken !== 'string' || !token.accessToken) throw new Error('Missing token');
    const storedStoreDomain = normalizeStoreDomain(stored.store_domain);
    if (context.config.connectionMode === 'client_credentials' && !context.config.allowedStoreDomains.includes(storedStoreDomain)) return null;
    if (context.storeDomain && storedStoreDomain !== context.storeDomain) return null;
    const expiresAt = typeof token.expiresAt === 'number' && Number.isFinite(token.expiresAt) ? token.expiresAt : null;
    if (context.config.connectionMode === 'client_credentials' && (expiresAt === null || expiresAt <= Date.now() + CLIENT_CREDENTIALS_REFRESH_BUFFER_MS)) {
      return null;
    }
    return { storeDomain: storedStoreDomain, accessToken: token.accessToken, scope: stored.scope || null, expiresAt };
  } catch {
    throw new ProductionShopifyError('Your saved Shopify connection cannot be opened. Reconnect Shopify to refresh it.', 409, 'SHOPIFY_REAUTH_REQUIRED');
  }
}

async function saveConnection(context: AuthenticatedShopifyRequest, pending: PendingConnection) {
  const result = await context.supabase.from('finance_shopify_connections').upsert({
    user_id: context.userId,
    store_domain: pending.storeDomain,
    access_token_ciphertext: encryptJson({ accessToken: pending.accessToken, expiresAt: pending.tokenExpiresAt }, context.config.tokenEncryptionSecret),
    scope: pending.scope,
    connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (result.error) throw new ProductionShopifyError('GCS Books could not save your Shopify connection. Check Supabase and try again.', 503, 'SHOPIFY_DATABASE_NOT_READY');
  return { storeDomain: pending.storeDomain, accessToken: pending.accessToken, scope: pending.scope, expiresAt: pending.tokenExpiresAt };
}

export async function resolveShopifyConnection(request: Request, context: AuthenticatedShopifyRequest, options: { forceRefresh?: boolean } = {}) {
  const saved = options.forceRefresh ? null : await readStoredConnection(context);
  if (saved) return saved;
  if (context.config.connectionMode === 'client_credentials') {
    if (!context.storeDomain) throw new ProductionShopifyError('Choose your Shopify store before starting the import.', 400, 'SHOPIFY_STORE_REQUIRED');
    const token = await exchangeClientCredentials(context.config, context.storeDomain);
    return saveConnection(context, {
      userId: context.userId,
      storeDomain: context.storeDomain,
      accessToken: token.accessToken,
      scope: token.scope,
      tokenExpiresAt: token.expiresAt,
      expiresAt: Date.now() + OAUTH_STATE_TTL_SECONDS * 1000,
    });
  }
  const rawPending = parseCookies(request).get(PENDING_CONNECTION_COOKIE);
  if (!rawPending) return null;
  let pending: PendingConnection;
  try {
    pending = decryptJson<PendingConnection>(rawPending, context.config.tokenEncryptionSecret);
  } catch {
    throw new ProductionShopifyError('The Shopify approval session is invalid. Start the import again.', 409, 'SHOPIFY_AUTH_INVALID');
  }
  if (pending.userId !== context.userId || (context.storeDomain !== null && pending.storeDomain !== context.storeDomain) || pending.expiresAt < Date.now()) {
    throw new ProductionShopifyError('The Shopify approval session expired. Start the import again.', 409, 'SHOPIFY_AUTH_EXPIRED');
  }
  return saveConnection(context, pending);
}

export function createShopifyAdminExecutor(config: ProductionShopifyConfig, connection: ShopifyConnection): ShopifyQueryExecutor {
  return async (query: string, variables: JsonRecord): Promise<GraphQLResponse> => {
    const endpoint = `https://${connection.storeDomain}/admin/api/${config.apiVersion}/graphql.json`;
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': connection.accessToken,
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch {
      throw new ProductionShopifyError('Shopify could not be reached. Check the store connection and try again.', 502, 'SHOPIFY_NETWORK_ERROR');
    }
    const payload = await response.json().catch(() => ({})) as GraphQLResponse;
    const messages = payload.errors?.map((error) => error.message || '').filter(Boolean) || [];
    if (response.status === 401 || response.status === 403 || messages.some((message) => /access|auth|token|permission|unauthori[sz]ed/i.test(message))) {
      throw new ProductionShopifyError('Your Shopify connection needs to be approved again. Start the import to reconnect it.', 409, 'SHOPIFY_REAUTH_REQUIRED');
    }
    if (!response.ok) throw new ProductionShopifyError('Shopify returned an error while reading the store. Try the import again.', 502, 'SHOPIFY_API_ERROR');
    if (messages.length) throw new ProductionShopifyError(messages.join(' · ').slice(0, 500), 502, 'SHOPIFY_API_ERROR');
    return payload;
  };
}

export { OAUTH_STATE_COOKIE, PENDING_CONNECTION_COOKIE };
