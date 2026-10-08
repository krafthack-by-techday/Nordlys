// Felles tilgang til Supabase for styringsgruppe-siden.
// Økten (fra innloggingen i index.html) ligger i sessionStorage: { token, refresh, epost, utloper }.
export const SB = 'https://qwgtzrydzzkaiezyouxt.supabase.co';
export const KEY = 'sb_publishable_gUJZpDFXutZiMKjKLcMO-g_lXaAz4m3';
export const SKEY = 'nordlys-styringsgruppe-okt';

export class KonfliktFeil extends Error {
  constructor() { super('Noen andre har endret dette i mellomtiden. Last inn på nytt og prøv igjen.'); this.name = 'KonfliktFeil'; }
}
export class TilgangFeil extends Error {
  constructor(m) { super(m || 'Økten er utløpt. Logg inn på nytt.'); this.name = 'TilgangFeil'; }
}

function les() { try { return JSON.parse(sessionStorage.getItem(SKEY) || 'null'); } catch { return null; } }
export function lagreOkt(s) { try { sessionStorage.setItem(SKEY, JSON.stringify(s)); } catch {} }
export function slettOkt() { try { sessionStorage.removeItem(SKEY); } catch {} }

/** Navn til visning, laget av e-posten: kari.nordmann@x.no → Kari Nordmann. */
export function navnFra(epost) {
  return String(epost || '').split('@')[0].split(/[._-]+/).filter(Boolean)
    .map((d) => d[0].toUpperCase() + d.slice(1)).join(' ');
}

export function okt() {
  const s = les();
  return s && s.token ? { token: s.token, epost: s.epost, navn: navnFra(s.epost) } : null;
}

let fornyer = null;
/** Gyldig access token. Fornyer med refresh_token når det er under ett minutt igjen. */
export async function token() {
  const s = les();
  if (!s || !s.token) throw new TilgangFeil();
  if (s.utloper - Date.now() > 60000 || !s.refresh) return s.token;
  fornyer ??= (async () => {
    try {
      const r = await fetch(SB + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.access_token) { if (s.utloper > Date.now()) return s.token; throw new TilgangFeil(); }
      const ny = { ...s, token: d.access_token, refresh: d.refresh_token || s.refresh, utloper: Date.now() + (Number(d.expires_in) || 3600) * 1000 };
      lagreOkt(ny);
      return ny.token;
    } finally { fornyer = null; }
  })();
  return fornyer;
}

async function kall(sti, { method = 'GET', body, prefer } = {}) {
  const t = await token();
  const r = await fetch(SB + '/rest/v1/' + sti, {
    method,
    headers: { apikey: KEY, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.status === 401) throw new TilgangFeil();
  if (r.status === 403) throw new TilgangFeil('Du har ikke tilgang til å gjøre dette.');
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.message || ('Feil fra serveren (' + r.status + ')'));
  }
  if (r.status === 204) return null;
  const tekst = await r.text();
  return tekst ? JSON.parse(tekst) : null;
}

export function hent(tabell, query = '') { return kall(tabell + (query ? '?' + query : '')); }

const SKRIVEBESKYTTET = ['id', 'endret', 'endret_av'];
const utenSystemfelt = (rad) => Object.fromEntries(Object.entries(rad).filter(([k]) => !SKRIVEBESKYTTET.includes(k)));

/** Ny rad (uten id) settes inn. Rad med id og endret oppdateres bare hvis ingen andre har endret den i mellomtiden. */
export async function lagre(tabell, rad) {
  if (!rad.id) {
    const ny = await kall(tabell, { method: 'POST', body: utenSystemfelt(rad), prefer: 'return=representation' });
    varsleEndring();
    return ny[0];
  }
  let filter = 'id=eq.' + encodeURIComponent(rad.id);
  if (rad.endret) filter += '&endret=eq.' + encodeURIComponent(rad.endret);
  const ut = await kall(tabell + '?' + filter, { method: 'PATCH', body: utenSystemfelt(rad), prefer: 'return=representation' });
  if (!ut || !ut.length) throw new KonfliktFeil();
  varsleEndring();
  return ut[0];
}

export async function slett(tabell, id) {
  await kall(tabell + '?id=eq.' + encodeURIComponent(id), { method: 'DELETE' });
  varsleEndring();
}

export function rpc(navn, args = {}) { return kall('rpc/' + navn, { method: 'POST', body: args }); }

let redaktor = null;
export async function erRedaktor() {
  if (redaktor === null) { try { redaktor = (await rpc('er_redaktor')) === true; } catch { redaktor = false; } }
  return redaktor;
}
export function glemRolle() { redaktor = null; }

export function varsleEndring() { window.dispatchEvent(new CustomEvent('sg:endret')); }
