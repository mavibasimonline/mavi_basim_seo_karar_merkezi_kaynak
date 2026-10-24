import { decrypt, encrypt, cookie, equalSecret } from './security';
import { Env, Fetch, hash, nowISO, json } from './types';

export class ProviderError extends Error {
  constructor(public code: string, public retryable = false, public retryAfterSeconds = 0) { super(code); }
}
export async function boundedText(response: Response, limit = 2_000_000): Promise<string> {
  if (Number(response.headers.get('content-length')) > limit) throw new ProviderError('RESPONSE_TOO_LARGE');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new ProviderError('RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(combined);
}
export async function requestJSON<T>(url: string, init: RequestInit, fetcher: Fetch = fetch): Promise<T> {
  let response: Response;
  try { response = await fetcher(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(20_000) }); }
  catch (error) {
    // Never print request URLs, authorization codes, tokens or error messages.
    // A timeout is different from DNS/TLS/network failure and deserves its own code.
    const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new ProviderError(timeout ? 'GOOGLE_NETWORK_TIMEOUT' : 'NETWORK_UNAVAILABLE', true);
  }
  // Do not follow redirects with credentials; manual mode is supported by Workers.
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new ProviderError('GOOGLE_UNEXPECTED_REDIRECT');
  }
  if (!response.ok) {
    await response.body?.cancel();
    const retryHeader = response.headers.get('Retry-After');
    const seconds = retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader) : retryHeader ? Math.ceil((Date.parse(retryHeader) - Date.now()) / 1000) : 0;
    throw new ProviderError(`GOOGLE_HTTP_${response.status}`, response.status === 429 || response.status >= 500, Math.max(0, Math.min(seconds || 0, 86400)));
  }
  try { return JSON.parse(await boundedText(response)) as T; }
  catch (error) { if (error instanceof ProviderError) throw error; throw new ProviderError('INVALID_GOOGLE_JSON'); }
}

interface Tokens { access_token: string; refresh_token?: string; expires_at: number; scope: string }
interface TokenReply { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string }
export const READ_SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly', 'https://www.googleapis.com/auth/analytics.readonly'];
export const requiredScopes = (env:Env) => env.GA4_PROPERTY_ID ? [...READ_SCOPES] : [READ_SCOPES[0]];
export async function saveTokens(env: Env, tokens: Tokens): Promise<void> {
  if (!env.TOKEN_ENCRYPTION_KEY) throw new ProviderError('MISSING_ENCRYPTION_KEY');
  await env.DB.prepare('INSERT INTO oauth_credentials VALUES(?,?,?,?) ON CONFLICT(provider) DO UPDATE SET encrypted_tokens=excluded.encrypted_tokens, scopes=excluded.scopes, updated_at=excluded.updated_at')
    .bind('google', await encrypt(tokens, env.TOKEN_ENCRYPTION_KEY), tokens.scope, nowISO()).run();
}
export async function accessToken(env: Env, fetcher: Fetch = fetch, forceRefresh = false): Promise<string> {
  const stored = await env.DB.prepare('SELECT encrypted_tokens FROM oauth_credentials WHERE provider=?').bind('google').first<{ encrypted_tokens: string }>();
  if (!stored || !env.TOKEN_ENCRYPTION_KEY || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new ProviderError('GOOGLE_NOT_CONNECTED');
  let tokens: Tokens;
  try { tokens = await decrypt<Tokens>(stored.encrypted_tokens, env.TOKEN_ENCRYPTION_KEY); }
  catch { throw new ProviderError('TOKEN_DECRYPTION_FAILED'); }
  if (!forceRefresh && tokens.expires_at > Date.now() + 60_000) return tokens.access_token;
  if (!tokens.refresh_token) throw new ProviderError('OAUTH_RECONNECT_REQUIRED');
  const reply = await requestJSON<TokenReply>('https://oauth2.googleapis.com/token', {
    method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET }),
  }, fetcher);
  if (typeof reply.access_token !== 'string' || !Number.isFinite(reply.expires_in) || reply.expires_in! <= 0) throw new ProviderError('INVALID_TOKEN_RESPONSE');
  tokens = { access_token: reply.access_token, refresh_token: reply.refresh_token || tokens.refresh_token, expires_at: Date.now() + reply.expires_in! * 1000, scope: reply.scope || tokens.scope };
  await saveTokens(env, tokens);
  return tokens.access_token;
}
export async function googleJSON<T>(env: Env, url: string, body: unknown, fetcher: Fetch = fetch, extraHeaders: Record<string, string> = {}): Promise<T> {
  const token = await accessToken(env, fetcher);
  try { return await requestJSON<T>(url, { method: 'POST', headers: { ...extraHeaders, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, fetcher); }
  catch (error) {
    if (!(error instanceof ProviderError) || error.code !== 'GOOGLE_HTTP_401') throw error;
    const refreshed = await accessToken(env, fetcher, true);
    return requestJSON<T>(url, { method: 'POST', headers: { ...extraHeaders, Authorization: `Bearer ${refreshed}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, fetcher);
  }
}
/** Read-only live Search Console permission check; does not import or invent traffic. */
export async function verifyGscAccess(env: Env, fetcher: Fetch = fetch): Promise<{ api_access: true; property: string; queried_day: string; rows_returned: number; note: string }> {
  if (!env.GSC_PROPERTY) throw new ProviderError('GSC_CONFIGURATION_MISSING');
  const day = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const token = await accessToken(env, fetcher);
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(env.GSC_PROPERTY)}/searchAnalytics/query`;
  const body = JSON.stringify({startDate:day,endDate:day,dimensions:['date'],type:'web',dataState:'final',rowLimit:1});
  const send = (access: string) => requestJSON<{rows?: unknown[]}>(url,{method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},body},fetcher);
  let result;
  try { result = await send(token); }
  catch (error) {
    if (!(error instanceof ProviderError) || error.code !== 'GOOGLE_HTTP_401') throw error;
    result = await send(await accessToken(env,fetcher,true));
  }
  if (!result || (result.rows !== undefined && !Array.isArray(result.rows))) throw new ProviderError('INVALID_GSC_RESPONSE');
  return {api_access:true,property:env.GSC_PROPERTY,queried_day:day,rows_returned:result.rows?.length||0,
    note:'API sorgusu başarılı. Bu izin testi veri aktarımı veya gün kapsamı doğrulaması değildir; sıfır satır sıfır trafik demek değildir.'};
}
export async function oauthStart(env: Env): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI || !env.TOKEN_ENCRYPTION_KEY) return json({ error: 'Google OAuth ve token şifreleme ayarları eksik.' }, 503);
  const redirect = new URL(env.GOOGLE_REDIRECT_URI);
  if (redirect.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(redirect.hostname)) return json({ error: 'OAuth dönüş adresi HTTPS olmalı.' }, 503);
  const state = crypto.randomUUID() + crypto.randomUUID();
  await env.DB.prepare('DELETE FROM oauth_states WHERE expires_at < ?').bind(nowISO()).run();
  await env.DB.prepare('INSERT INTO oauth_states VALUES(?,?)').bind(await hash(state), new Date(Date.now() + 600_000).toISOString()).run();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  const scopes = requiredScopes(env);
  if (env.ENABLE_GOOGLE_ADS === 'true') scopes.push('https://www.googleapis.com/auth/adwords');
  url.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: env.GOOGLE_REDIRECT_URI, response_type: 'code', scope: scopes.join(' '), access_type: 'offline', prompt: 'consent', state }).toString();
  return new Response(JSON.stringify({ authorization_url: url.href }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': `mavi_oauth=${state}; HttpOnly; Secure; SameSite=Lax; Path=/api/oauth/google; Max-Age=600` } });
}
export async function oauthCallback(request: Request, env: Env, fetcher: Fetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  const stored = await env.DB.prepare('DELETE FROM oauth_states WHERE state_hash=? AND expires_at>? RETURNING state_hash').bind(await hash(state), nowISO()).first();
  if (!stored || !state || !await equalSecret(state, cookie(request, 'mavi_oauth') || '')) return json({ error: 'OAuth durumu geçersiz veya süresi dolmuş.' }, 400);
  const code = url.searchParams.get('code');
  if (!code || url.searchParams.has('error')) return json({ error: 'Google izni verilmedi.' }, 400);
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) return json({ error: 'OAuth ayarları eksik.' }, 503);
  const reply = await requestJSON<TokenReply>('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: env.GOOGLE_REDIRECT_URI }) }, fetcher);
  if (typeof reply.access_token !== 'string' || !reply.refresh_token || !Number.isFinite(reply.expires_in) || reply.expires_in! <= 0 || !requiredScopes(env).every(scope => reply.scope?.split(' ').includes(scope))) return json({ error: 'Gerekli salt okunur kapsamlar veya yenileme izni eksik.' }, 400);
  await saveTokens(env, { access_token: reply.access_token, refresh_token: reply.refresh_token, expires_at: Date.now() + reply.expires_in! * 1000, scope: reply.scope! });
  await env.DB.prepare("UPDATE sync_jobs SET status='pending', attempts=0, next_attempt_at=?, error_code=NULL WHERE status='blocked' AND provider IN ('gsc','ga4','ads')").bind(nowISO()).run();
  return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': 'mavi_oauth=; HttpOnly; Secure; SameSite=Lax; Path=/api/oauth/google; Max-Age=0', 'Cache-Control': 'no-store' } });
}
