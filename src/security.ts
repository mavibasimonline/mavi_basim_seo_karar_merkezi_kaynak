import { Env, hash, json } from './types';

const encoder = new TextEncoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));

export async function equalSecret(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([hash(a), hash(b)]);
  let difference = 0;
  for (let i = 0; i < x.length; i++) difference |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return difference === 0;
}
export function cookie(request: Request, name: string): string | undefined {
  return request.headers.get('Cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1);
}
async function signature(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}
export async function authenticated(request: Request, env: Env): Promise<boolean> {
  if (!env.ADMIN_TOKEN) return false;
  const bearer = request.headers.get('Authorization');
  if (bearer?.startsWith('Bearer ')) return equalSecret(bearer.slice(7), env.ADMIN_TOKEN);
  const session = cookie(request, 'mavi_session');
  if (!session) return false;
  const [expires, nonce, mac] = session.split('.');
  if (!expires || !nonce || !mac || !/^\d+$/.test(expires) || Number(expires) < Date.now()) return false;
  return equalSecret(mac, await signature(`${expires}.${nonce}`, env.ADMIN_TOKEN));
}
export function safeOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  return origin === new URL(request.url).origin || (!origin && !!request.headers.get('Authorization'));
}
export async function login(request: Request, env: Env): Promise<Response> {
  if (!env.ADMIN_TOKEN) return json({ error: 'Güvenli yönetici erişimi yapılandırılmamış.' }, 503);
  if (!safeOrigin(request)) return json({ error: 'Geçersiz istek kaynağı.' }, 403);
  const client = await hash((request.headers.get('CF-Connecting-IP') || 'local') + env.ADMIN_TOKEN);
  const time = new Date();
  const previous = await env.DB.prepare('SELECT attempts, window_start FROM auth_attempts WHERE client_hash=?').bind(client).first<{ attempts: number; window_start: string }>();
  const active = previous && time.getTime() - Date.parse(previous.window_start) < 15 * 60_000;
  if (active && previous.attempts >= 5) return json({ error: 'Çok fazla deneme. 15 dakika sonra tekrar deneyin.' }, 429);
  const body = await request.json() as { token?: unknown };
  if (typeof body.token !== 'string' || body.token.length > 512 || !await equalSecret(body.token, env.ADMIN_TOKEN)) {
    await env.DB.prepare('INSERT INTO auth_attempts VALUES(?,?,?) ON CONFLICT(client_hash) DO UPDATE SET attempts=excluded.attempts, window_start=excluded.window_start')
      .bind(client, active ? previous.attempts + 1 : 1, active ? previous.window_start : time.toISOString()).run();
    return json({ error: 'Erişim anahtarı geçersiz.' }, 401);
  }
  await env.DB.prepare('DELETE FROM auth_attempts WHERE client_hash=?').bind(client).run();
  const payload = `${time.getTime() + 12 * 60 * 60_000}.${crypto.randomUUID()}`;
  return new Response(JSON.stringify({ ok: true }), { headers: {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'Set-Cookie': `mavi_session=${payload}.${await signature(payload, env.ADMIN_TOKEN)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`,
  } });
}
export async function encrypt(value: unknown, encodedKey: string): Promise<string> {
  const bytes = unb64(encodedKey);
  if (bytes.length !== 32) throw new Error('INVALID_ENCRYPTION_KEY');
  const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(value)));
  return `v1.${b64(iv)}.${b64(new Uint8Array(ciphertext))}`;
}
export async function decrypt<T>(value: string, encodedKey: string): Promise<T> {
  const [version, iv, ciphertext] = value.split('.');
  if (version !== 'v1') throw new Error('UNKNOWN_ENCRYPTION_VERSION');
  const key = await crypto.subtle.importKey('raw', unb64(encodedKey), 'AES-GCM', false, ['decrypt']);
  const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ciphertext));
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
export function securityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
