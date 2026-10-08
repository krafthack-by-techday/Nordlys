// Visningen av styringsgruppe-siden.
// Alt fra databasen settes med textContent. Eneste unntak er trygHtml (hviteliste-renser).
import * as api from './api.js';

/* ---------- navn og farger ---------- */
export const FARGER = {
  gronn: { navn: 'Grønn', css: 'var(--mint)', rang: 2 },
  gul: { navn: 'Gul', css: 'var(--gold)', rang: 1 },
  rod: { navn: 'Rød', css: 'var(--red)', rang: 0 },
  ikke_satt: { navn: 'Ikke satt', css: 'var(--faint)', rang: null },
};
export const NIVAER = {
  hoy: { navn: 'Høy', css: 'var(--red)', rang: 0 },
  middels: { navn: 'Middels', css: 'var(--amber)', rang: 1 },
  lav: { navn: 'Lav', css: 'var(--mint)', rang: 2 },
  ikke_vurdert: { navn: 'Ikke vurdert', css: 'var(--faint)', rang: 3 },
};
export const SAKSTATUS = { til_behandling: 'Til behandling', besluttet: 'Besluttet', utsatt: 'Utsatt' };

/* ---------- datoer (Europe/Oslo, nb-NO) ---------- */
const TZ = 'Europe/Oslo';
const DAG = 86400000;
const fmtCache = new Map();
function fmt(opts) {
  const k = JSON.stringify(opts);
  if (!fmtCache.has(k)) fmtCache.set(k, new Intl.DateTimeFormat('nb-NO', { timeZone: TZ, ...opts }));
  return fmtCache.get(k);
}
/** 'YYYY-MM-DD' for en dato-streng, et Date-objekt eller et tidsstempel. Date regnes om til Oslo-tid. */
export function isoDato(d) {
  if (d == null || d === '') return null;
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) && d.length <= 10) return d.slice(0, 10);
  const t = d instanceof Date ? d : new Date(d);
  if (isNaN(t)) return null;
  const p = Object.fromEntries(fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(t).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export function iDag() { return isoDato(new Date()); }
const dagnr = (s) => { const [y, m, d] = isoDato(s).split('-').map(Number); return Date.UTC(y, m - 1, d) / DAG; };
const somDato = (s) => { const [y, m, d] = isoDato(s).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); };
const stor = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** «26. oktober 2026». Med { aar: false }: «26. oktober». */
export function datoTekst(d, { aar = true, ukedag = false } = {}) {
  if (!isoDato(d)) return '';
  return fmt({ day: 'numeric', month: 'long', ...(aar ? { year: 'numeric' } : {}), ...(ukedag ? { weekday: 'long' } : {}) }).format(somDato(d));
}
const maanedAar = (d) => fmt({ month: 'long', year: 'numeric' }).format(somDato(d));
const maaned = (d) => fmt({ month: 'long' }).format(somDato(d));
const maanedKort = (d) => fmt({ month: 'short' }).format(somDato(d)).replace('.', '');

const flertall = (n, en, flere) => `${n} ${n === 1 ? en : flere}`;
/** «om 3 dager», «om 3 uker», «om 5 måneder», «i dag», «for 2 uker siden». */
export function relativTid(d, idag = iDag()) {
  const diff = dagnr(d) - dagnr(idag);
  if (diff === 0) return 'i dag';
  if (diff === 1) return 'i morgen';
  if (diff === -1) return 'i går';
  const a = Math.abs(diff);
  let t;
  if (a < 14) t = flertall(a, 'dag', 'dager');
  else if (a < 60) t = flertall(Math.round(a / 7), 'uke', 'uker');
  else if (a < 730) t = flertall(Math.round(a / 30.44), 'måned', 'måneder');
  else t = flertall(Math.round(a / 365.25), 'år', 'år');
  return diff > 0 ? 'om ' + t : 'for ' + t + ' siden';
}
const omDager = (n) => (n === 0 ? 'i dag' : n === 1 ? 'i morgen' : n > 0 ? `om ${n} dager` : `for ${-n} dager siden`);

const forsteIMnd = (s) => isoDato(s).endsWith('-01');
const sisteIMnd = (s) => { const t = somDato(s); t.setUTCDate(t.getUTCDate() + 1); return t.getUTCDate() === 1; };
/** Tekst for en milepæl: «juni 2026», «februar–mars 2027», «28. oktober–3. november 2026» eller «26. oktober 2026». */
export function periodeTekst(m) {
  const fra = isoDato(m.dato), til = isoDato(m.til);
  if (!til || til === fra) return datoTekst(fra);
  const sammeAar = fra.slice(0, 4) === til.slice(0, 4);
  if (forsteIMnd(fra) && sisteIMnd(til)) {
    if (fra.slice(0, 7) === til.slice(0, 7)) return maanedAar(fra);
    return sammeAar ? `${maaned(fra)}–${maanedAar(til)}` : `${maanedAar(fra)}–${maanedAar(til)}`;
  }
  if (fra.slice(0, 7) === til.slice(0, 7)) return `${Number(fra.slice(8))}.–${datoTekst(til)}`;
  return sammeAar ? `${datoTekst(fra, { aar: false })}–${datoTekst(til)}` : `${datoTekst(fra)}–${datoTekst(til)}`;
}

/* ---------- tidslinjen (ren funksjon) ---------- */
/**
 * Regner ut tallene, framdriftslinjen og listen for tidslinjen.
 * @param {Array} milepaeler rader fra sg_milepaeler
 * @param {{start?:string, slutt?:string}} innstillinger raden fra sg_innstillinger
 * @param {string|Date} idag
 */
export function tidslinje(milepaeler, innstillinger = {}, idag = iDag()) {
  const t = isoDato(idag), T = dagnr(t);
  const ms = (milepaeler || []).filter((m) => m && isoDato(m.dato))
    .slice().sort((a, b) => dagnr(a.dato) - dagnr(b.dato) || (a.til ? dagnr(a.til) : 0) - (b.til ? dagnr(b.til) : 0));

  const liste = ms.map((m) => {
    const a = dagnr(m.dato), b = dagnr(m.til || m.dato);
    const periode = !!m.til && b > a;
    const status = b < T ? 'ferdig' : a <= T ? 'pagar' : 'kommende';
    return {
      id: m.id, milepael: m, tekst: m.tekst, viktig: !!m.viktig, periode, status, neste: false,
      datoTekst: stor(periodeTekst(m)),
      statusTekst: status === 'ferdig' ? 'Ferdig' : status === 'pagar' ? (periode ? 'Pågår' : 'I dag') : stor(relativTid(m.dato, t)),
      relativ: status === 'kommende' ? relativTid(m.dato, t) : null,
    };
  });
  const nesteRad = liste.find((r) => r.status === 'kommende') || null;
  if (nesteRad) nesteRad.neste = true;

  let viktig = null;
  const vm = ms.find((m) => m.viktig);
  if (vm) {
    const maal = isoDato(vm.til || vm.dato);
    const dager = dagnr(maal) - T;
    viktig = { milepael: vm, dager, uker: Math.max(0, Math.round(dager / 7)), tekst: `til beslutningen (${maanedAar(maal)})` };
  }

  let neste = null;
  if (nesteRad) {
    const m = nesteRad.milepael, dager = dagnr(m.dato) - T;
    neste = { milepael: m, dager, tekst: `Neste: ${String(m.tekst).replace(/\.$/, '')} – ${omDager(dager)} (${datoTekst(m.dato, { aar: false })})` };
  }

  let uke = null;
  const inn = innstillinger || {};
  if (isoDato(inn.start) && isoDato(inn.slutt)) {
    const s = dagnr(inn.start), e = dagnr(inn.slutt);
    const av = Math.max(1, Math.ceil((e - s + 1) / 7));
    if (T < s) uke = { n: 0, av, tekst: `Starter ${relativTid(inn.start, t)}` };
    else { const n = Math.min(av, Math.floor((T - s) / 7) + 1); uke = { n, av, tekst: T > e ? `Avsluttet (${av} uker)` : `Uke ${n} av ${av}` }; }
  }

  // framdriftslinjen: fra første dag i startmåneden til siste dag i sluttmåneden
  let framdrift = null;
  const kandidater = [inn.start, inn.slutt, ...ms.map((m) => m.dato), ...ms.map((m) => m.til)].filter((x) => isoDato(x)).map(dagnr);
  if (kandidater.length) {
    const lo = somDato(new Date(Math.min(...kandidater) * DAG)); lo.setUTCDate(1);
    const hi = somDato(new Date(Math.max(...kandidater) * DAG)); hi.setUTCMonth(hi.getUTCMonth() + 1, 0);
    const fra = Math.round(lo.getTime() / DAG - 0.5), til = Math.round(hi.getTime() / DAG - 0.5) + 1;
    const span = Math.max(1, til - fra);
    const pst = (d) => Math.round(((dagnr(d) - fra) / span) * 10000) / 100;
    const maaneder = [];
    const c = new Date(lo);
    while (c <= hi) {
      const iso = c.toISOString().slice(0, 10);
      maaneder.push({ tekst: maanedKort(iso), pst: pst(iso), aar: c.getUTCMonth() === 0 || !maaneder.length ? String(c.getUTCFullYear()) : null });
      c.setUTCMonth(c.getUTCMonth() + 1, 1);
    }
    framdrift = {
      fra: lo.toISOString().slice(0, 10), til: hi.toISOString().slice(0, 10),
      idagPst: Math.max(0, Math.min(100, Math.round(((T - fra) / span) * 10000) / 100)),
      punkter: liste.map((r) => ({ id: r.id, tekst: r.tekst, datoTekst: r.datoTekst, status: r.status, viktig: r.viktig, neste: r.neste,
        pst: pst(r.milepael.dato), tilPst: r.periode ? Math.round(((dagnr(r.milepael.til) + 1 - fra) / span) * 10000) / 100 : null })),
      maaneder,
    };
  }
  return { idag: t, viktig, neste, uke, framdrift, liste };
}

/* ---------- hviteliste-renser ---------- */
const TILLATT = new Set(['P', 'BR', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'STRONG', 'B', 'EM', 'I', 'S', 'U', 'A', 'BLOCKQUOTE', 'HR', 'CODE', 'PRE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD']);
const FJERN_HELT = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH', 'TITLE', 'HEAD', 'META', 'LINK', 'BASE', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'IMG', 'VIDEO', 'AUDIO', 'CANVAS', 'FORM', 'FRAME', 'FRAMESET']);
const trygLenke = (h) => { const v = String(h || '').trim(); return /^https:\/\//i.test(v) || /^mailto:/i.test(v) ? v : null; };

/** Renser HTML (fra Tiptap) med en hviteliste og gir et DocumentFragment. */
export function trygHtml(html) {
  const ut = document.createDocumentFragment();
  if (!html) return ut;
  const kilde = new DOMParser().parseFromString(String(html), 'text/html');
  const kopier = (fra, til) => {
    for (const n of fra.childNodes) {
      if (n.nodeType === 3) { til.appendChild(document.createTextNode(n.nodeValue)); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toUpperCase();
      if (FJERN_HELT.has(tag)) continue;
      if (!TILLATT.has(tag)) { kopier(n, til); continue; } // pakk ut (div, span, label …)
      const e = document.createElement(tag.toLowerCase());
      if (tag === 'A') {
        const h = trygLenke(n.getAttribute('href'));
        if (h) { e.setAttribute('href', h); e.setAttribute('target', '_blank'); e.setAttribute('rel', 'noopener'); }
      }
      if (tag === 'UL' && n.getAttribute('data-type') === 'taskList') e.className = 'sg-oppgaver';
      kopier(n, e);
      if (tag === 'LI' && n.hasAttribute('data-checked')) {
        const boks = document.createTextNode(n.getAttribute('data-checked') === 'true' ? '☑ ' : '☐ ');
        const forste = e.firstElementChild && e.firstElementChild.tagName === 'P' && e.firstChild === e.firstElementChild ? e.firstElementChild : e;
        forste.insertBefore(boks, forste.firstChild);
      }
      til.appendChild(e);
    }
  };
  kopier(kilde.body, ut);
  return ut;
}

/* ---------- DOM-hjelpere ---------- */
export function el(tag, attr, ...barn) {
  const e = document.createElement(tag);
  if (attr) for (const [k, v] of Object.entries(attr)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'tekst') e.textContent = v;
    else if (k === 'style') e.setAttribute('style', v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const b of barn.flat(Infinity)) { if (b == null || b === false) continue; e.append(b instanceof Node ? b : String(b)); }
  return e;
}
const prikk = (css, tittel) => el('span', { class: 'sg-prikk', style: `background:${css}`, title: tittel, 'aria-hidden': 'true' });
const merke = (tekst, klasse = '') => el('span', { class: 'sg-merke ' + klasse, tekst });
function rad(e, tabell, r) {
  if (!r) return e;
  e.dataset.tabell = tabell;
  if (r.id != null) e.dataset.id = r.id;
  if (r.publisert === false) { e.classList.add('sg-utkast'); e.prepend(merke('Utkast', 'utkast')); }
  return e;
}
/** Bakgrunn som punkter: én linje per punkt, uten innledende tankestrek eller kulepunkt. */
export function punkter(tekst) {
  return String(tekst || '').split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-–•*·]|\d+[.)])\s+/, '').trim()).filter(Boolean);
}
/** Kort tekst for et agendapunkt. */
export function agendaTekst(p, saker = []) {
  switch (p && p.type) {
    case 'status': return 'Status';
    case 'sak': { const s = saker.find((x) => x.id === p.sak_id); return s ? s.tittel : null; }
    case 'risiko': return 'Risiko';
    case 'aksjoner': return 'Aksjonspunkter';
    case 'tidslinje': return 'Tidslinje';
    case 'fritt': return (p.tekst || '').trim() || null;
    default: return null;
  }
}

/* ---------- data ---------- */
/** Henter alt siden trenger. Med kunPublisert filtreres utkast bort, slik en leser ser det. */
export async function hentAlt({ kunPublisert = false } = {}) {
  const ikkeFeil = (p) => p.catch(() => []);
  const [inn, moter, status, saker, aksjoner, risikoer, milepaeler, seksjoner, notater, redaktor] = await Promise.all([
    api.hent('sg_innstillinger', 'id=eq.1'),
    api.hent('sg_moter', 'order=dato.asc'),
    api.hent('sg_status', 'order=rekkefolge.asc'),
    api.hent('sg_saker', 'order=tittel.asc'),
    api.hent('sg_aksjoner', 'order=frist.asc.nullslast'),
    api.hent('sg_risikoer', 'order=rekkefolge.asc'),
    api.hent('sg_milepaeler', 'order=dato.asc'),
    api.hent('sg_seksjoner', 'order=rekkefolge.asc'),
    ikkeFeil(api.hent('sg_notater', 'select=mote_id,html')),
    api.erRedaktor(),
  ]);
  let d = { innstillinger: (inn && inn[0]) || {}, moter: moter || [], status: status || [], saker: saker || [], aksjoner: aksjoner || [],
    risikoer: risikoer || [], milepaeler: milepaeler || [], seksjoner: seksjoner || [], notater: notater || [], redaktor };
  if (kunPublisert) {
    const pub = (r) => r.publisert !== false;
    const moterP = d.moter.filter(pub), ider = new Set(moterP.map((m) => m.id));
    d = { ...d, moter: moterP, status: d.status.filter((s) => ider.has(s.mote_id)), saker: d.saker.filter(pub), aksjoner: d.aksjoner.filter(pub),
      risikoer: d.risikoer.filter(pub), milepaeler: d.milepaeler.filter(pub), seksjoner: d.seksjoner.filter(pub),
      notater: d.notater.filter((n) => moterP.some((m) => m.id === n.mote_id && m.referat_publisert)) };
  }
  return d;
}

/** Siste møte (etter dato) som har status, og møtet før det. */
export function statusMoter(moter, status) {
  const harStatus = (m) => status.some((s) => s.mote_id === m.id) || (m.samlet_status && m.samlet_status !== 'ikke_satt');
  const med = moter.filter(harStatus).sort((a, b) => dagnr(b.dato) - dagnr(a.dato));
  return { siste: med[0] || null, forrige: med[1] || null };
}
const sammenlign = (na, før) => {
  const a = FARGER[na] && FARGER[na].rang, b = FARGER[før] && FARGER[før].rang;
  if (a == null || b == null) return null;
  return a > b ? 'opp' : a < b ? 'ned' : 'lik';
};
const PIL = { opp: ['↑', 'Bedre enn sist'], ned: ['↓', 'Verre enn sist'], lik: ['→', 'Som sist'] };
const pil = (retning) => (retning ? el('span', { class: 'sg-pil ' + retning, title: PIL[retning][1], 'aria-label': PIL[retning][1] }, PIL[retning][0]) : null);

/* ---------- siden ---------- */
const tilstand = new WeakMap();

/** Henter data og tegner hele siden i rot. Tegner på nytt ved 'sg:endret'. */
export async function visSide(rot, valg = {}) {
  let s = tilstand.get(rot);
  if (!s) {
    s = { nr: 0, valg: {} };
    s.lytter = () => { if (rot.isConnected) tegn(rot).catch(() => {}); else window.removeEventListener('sg:endret', s.lytter); };
    window.addEventListener('sg:endret', s.lytter);
    tilstand.set(rot, s);
  }
  s.valg = { ...valg };
  return tegn(rot);
}

async function tegn(rot) {
  const s = tilstand.get(rot);
  const nr = ++s.nr;
  const { seSomLeser = false, idag: idagValg } = s.valg;
  let d;
  try { d = await hentAlt({ kunPublisert: seSomLeser }); }
  catch (e) {
    if (nr !== s.nr) return;
    rot.replaceChildren(el('div', { class: 'sg-side' }, el('p', { class: 'sg-feil', role: 'alert', tekst: e.message || 'Kunne ikke hente innholdet.' })));
    throw e;
  }
  if (nr !== s.nr) return;
  const idag = isoDato(idagValg) || iDag();
  const kontekst = { ...d, idag, redaktor: d.redaktor && !seSomLeser, seSomLeser };

  // husk åpne <details> og rulleposisjon
  const aapne = new Set([...rot.querySelectorAll('details[open][data-noekkel]')].map((x) => x.dataset.noekkel));
  const y = window.scrollY;

  const seksjoner = [
    nesteMote(kontekst), statusSeksjon(kontekst), avklaring(kontekst), aksjonSeksjon(kontekst),
    tidslinjeSeksjon(kontekst), beslutninger(kontekst), risikoSeksjon(kontekst),
    ...faste(kontekst),
  ];
  const side = el('div', { class: 'sg-side' + (seSomLeser ? ' sg-leser' : '') });
  const toc = el('nav', { class: 'toc', 'aria-label': 'Innhold' },
    seksjoner.map((x) => el('a', { href: '#' + x.sec.id, tekst: x.toc })));
  const ytreToc = [...document.querySelectorAll('nav.toc')].find((n) => !rot.contains(n));
  if (ytreToc) ytreToc.replaceChildren(...toc.childNodes);
  else side.append(el('div', { class: 'sg-toc' }, toc));
  side.append(...seksjoner.map((x) => x.sec));
  for (const det of side.querySelectorAll('details[data-noekkel]')) if (aapne.has(det.dataset.noekkel)) det.open = true;
  // lenkene i fortegnelsen ruller uten å endre #-ruten
  for (const a of (ytreToc || toc).querySelectorAll('a')) a.addEventListener('click', (e) => {
    const m = document.getElementById(a.getAttribute('href').slice(1));
    if (m) { e.preventDefault(); m.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
  rot.replaceChildren(side);
  if (y) window.scrollTo(0, y);
  window.dispatchEvent(new CustomEvent('sg:tegnet', { detail: { seSomLeser } }));
}

function seksjon(id, toc, eyebrow, tittel, ekstra = {}) {
  const sec = el('section', { id, class: 'sg-seksjon', 'data-seksjon': ekstra.nokkel || id });
  const hode = el('div', { class: 'sg-hode' },
    el('div', { class: 'sg-hode-tekst' }, eyebrow ? el('p', { class: 'eyebrow', tekst: eyebrow }) : null, el('h2', { tekst: tittel })),
    el('div', { class: 'sg-verktoy' }));
  sec.append(hode);
  return { sec, toc };
}
const tom = (tekst) => el('p', { class: 'sg-tom', tekst });

/* 1. Neste møte */
function nesteMote(k) {
  const x = seksjon('neste-mote', 'Neste møte', 'Styringsgruppen', 'Neste møte');
  const T = dagnr(k.idag);
  const kommende = k.moter.filter((m) => dagnr(m.dato) >= T);
  const tidligere = k.moter.filter((m) => dagnr(m.dato) < T).sort((a, b) => dagnr(b.dato) - dagnr(a.dato));
  const m = kommende[0];
  if (!m) x.sec.append(tom('Ingen møter er satt opp.'));
  else {
    const agenda = (m.agenda || []).map((p) => agendaTekst(p, k.saker)).filter(Boolean);
    const kort = rad(el('div', { class: 'card sg-mote' },
      el('p', { class: 'sg-mote-dato' }, el('strong', { tekst: stor(datoTekst(m.dato, { ukedag: true })) }), el('span', { class: 'sg-om', tekst: omDager(dagnr(m.dato) - T) })),
      el('p', { class: 'sg-meta', tekst: [m.tittel, m.sted].filter(Boolean).join(' · ') }),
      agenda.length ? el('ol', { class: 'sg-agenda' }, agenda.map((t) => el('li', { tekst: t }))) : el('p', { class: 'sg-meta', tekst: 'Agendaen er ikke klar.' }),
      el('div', { class: 'sg-knapper' },
        el('a', { class: 'btn primary small', href: '#presenter/' + m.id, tekst: 'Presenter' }),
        k.redaktor ? el('a', { class: 'btn small', href: '#notat/' + m.id, tekst: 'Møtenotat' }) : null)), 'sg_moter', m);
    x.sec.append(kort);
    if (kommende.length > 1) {
      x.sec.append(el('p', { class: 'sg-senere' }, 'Senere: ',
        kommende.slice(1).map((n, i) => rad(el('span', {}, i ? ', ' : '', datoTekst(n.dato)), 'sg_moter', n))));
    }
  }
  if (tidligere.length) {
    const liste = el('ul', { class: 'sg-tidligere-liste' }, tidligere.map((t) => {
      const notat = t.referat_publisert && k.notater.find((n) => n.mote_id === t.id && n.html);
      return rad(el('li', {},
        el('div', { class: 'sg-tidligere-rad' }, el('strong', { tekst: datoTekst(t.dato) }), el('span', { class: 'sg-meta', tekst: [t.tittel, t.sted].filter(Boolean).join(' · ') })),
        notat ? el('details', { class: 'sg-referat', 'data-noekkel': 'referat-' + t.id }, el('summary', { tekst: 'Referat' }), el('div', { class: 'sg-rik' }, trygHtml(notat.html))) : null),
      'sg_moter', t);
    }));
    x.sec.append(el('details', { class: 'sg-tidligere', 'data-noekkel': 'tidligere' }, el('summary', { tekst: `Tidligere møter (${tidligere.length})` }), liste));
  }
  return x;
}

/* 2. Status */
function statusSeksjon(k) {
  const { siste, forrige } = statusMoter(k.moter, k.status);
  const x = seksjon('status', 'Status', siste ? 'Fra møtet ' + datoTekst(siste.dato) : 'Status', 'Status');
  if (!siste) { x.sec.append(tom('Ingen status er rapportert ennå.')); return x; }
  const rader = k.status.filter((s) => s.mote_id === siste.id).sort((a, b) => (a.rekkefolge || 0) - (b.rekkefolge || 0));
  const før = forrige ? k.status.filter((s) => s.mote_id === forrige.id) : [];
  const f = FARGER[siste.samlet_status] || FARGER.ikke_satt;
  const gammel = dagnr(k.idag) - dagnr(siste.dato) > 42;
  const samlet = rad(el('div', { class: 'card sg-samlet' },
    el('div', { class: 'sg-samlet-topp' }, prikk(f.css, f.navn), el('strong', { tekst: 'Samlet: ' + f.navn }),
      pil(forrige && sammenlign(siste.samlet_status, forrige.samlet_status)),
      gammel ? merke('Ikke oppdatert på over 6 uker', 'gammel') : null),
    siste.samlet_kommentar ? el('p', { tekst: siste.samlet_kommentar }) : null), 'sg_moter', siste);
  const liste = el('ul', { class: 'sg-statusliste' }, rader.map((r) => {
    const rf = FARGER[r.farge] || FARGER.ikke_satt;
    const tidl = før.find((p) => p.navn.trim().toLowerCase() === r.navn.trim().toLowerCase());
    return rad(el('li', {},
      el('div', { class: 'sg-status-navn' }, prikk(rf.css, rf.navn), el('strong', { tekst: r.navn }), el('span', { class: 'sg-skjult', tekst: rf.navn }), pil(tidl && sammenlign(r.farge, tidl.farge))),
      r.kommentar ? el('p', { tekst: r.kommentar }) : null), 'sg_status', r);
  }));
  x.sec.append(samlet, rader.length ? liste : null);
  return x;
}

/* 3. Til avklaring */
export function sakKort(s, { klasse = 'card sg-sak' } = {}) {
  const bakgrunn = punkter(s.bakgrunn);
  return rad(el('article', { class: klasse },
    el('h3', { tekst: s.tittel }),
    bakgrunn.length ? el('ul', { class: 'sg-bakgrunn' }, bakgrunn.map((t) => el('li', { tekst: t }))) : null,
    s.anbefaling ? el('div', { class: 'sg-anbefaling' }, el('span', { class: 'tag', tekst: 'Anbefaling' }), el('p', { tekst: s.anbefaling })) : null), 'sg_saker', s);
}
function avklaring(k) {
  const x = seksjon('avklaring', 'Til avklaring', 'Saker', 'Til avklaring');
  const saker = k.saker.filter((s) => (s.status || 'til_behandling') === 'til_behandling');
  if (!saker.length) { x.sec.append(tom('Ingen saker venter på avklaring.')); return x; }
  const moter = k.moter.filter((m) => saker.some((s) => s.mote_id === m.id)).sort((a, b) => dagnr(a.dato) - dagnr(b.dato));
  for (const m of moter) {
    const pos = (s) => { const i = (m.agenda || []).findIndex((p) => p.type === 'sak' && p.sak_id === s.id); return i < 0 ? 999 : i; };
    const ms = saker.filter((s) => s.mote_id === m.id).sort((a, b) => pos(a) - pos(b));
    x.sec.append(el('h3', { class: 'area', tekst: 'Møtet ' + datoTekst(m.dato) }), el('div', { class: 'sg-saker' }, ms.map((s) => sakKort(s))));
  }
  const kjente = new Set(k.moter.map((m) => m.id));
  const uten = saker.filter((s) => !s.mote_id || !kjente.has(s.mote_id));
  if (uten.length) x.sec.append(el('h3', { class: 'area', tekst: 'Ikke satt opp på et møte' }), el('div', { class: 'sg-saker' }, uten.map((s) => sakKort(s))));
  return x;
}

/* 4. Aksjonspunkter */
export function aksjonLinje(a, idag) {
  const forfalt = !a.ferdig && a.frist && dagnr(a.frist) < dagnr(idag);
  return rad(el('li', { class: 'sg-aksjon' + (forfalt ? ' forfalt' : '') + (a.ferdig ? ' ferdig' : '') },
    el('p', { class: 'sg-hva' }, forfalt ? merke('Forfalt', 'forfalt') : null, el('span', { tekst: a.hva })),
    el('p', { class: 'sg-meta', tekst: [a.hvem, a.frist ? 'frist ' + datoTekst(a.frist) : null].filter(Boolean).join(' · ') })), 'sg_aksjoner', a);
}
function aksjonSeksjon(k) {
  const x = seksjon('aksjoner', 'Aksjoner', 'Oppfølging', 'Aksjonspunkter');
  const aapne = k.aksjoner.filter((a) => !a.ferdig);
  const ferdige = k.aksjoner.filter((a) => a.ferdig);
  x.sec.append(aapne.length ? el('ul', { class: 'sg-aksjoner' }, aapne.map((a) => aksjonLinje(a, k.idag))) : tom('Ingen åpne aksjonspunkter.'));
  if (ferdige.length) x.sec.append(el('details', { class: 'sg-ferdige', 'data-noekkel': 'ferdige' }, el('summary', { tekst: `Vis ferdige (${ferdige.length})` }),
    el('ul', { class: 'sg-aksjoner' }, ferdige.map((a) => aksjonLinje(a, k.idag)))));
  return x;
}

/* 5. Tidslinje */
export function framdriftslinje(f, { maaneder = true } = {}) {
  if (!f) return null;
  const bane = el('div', { class: 'sg-bane', role: 'img', 'aria-label': 'Framdrift fra ' + datoTekst(f.fra) + ' til ' + datoTekst(f.til) });
  bane.append(el('div', { class: 'sg-bane-spor' }, el('div', { class: 'sg-bane-fyll', style: `width:${f.idagPst}%` })));
  for (const p of f.punkter) {
    if (p.tilPst != null) bane.append(el('div', { class: 'sg-bane-periode ' + p.status + (p.viktig ? ' viktig' : ''), style: `left:${p.pst}%;width:${Math.max(0.6, p.tilPst - p.pst)}%`, title: p.datoTekst + ': ' + p.tekst }));
  }
  for (const p of f.punkter) {
    bane.append(el('div', { class: 'sg-bane-prikk ' + p.status + (p.viktig ? ' viktig' : '') + (p.neste ? ' neste' : ''), style: `left:${p.pst}%`, title: p.datoTekst + ': ' + p.tekst }));
  }
  bane.append(el('div', { class: 'sg-bane-idag', style: `left:${f.idagPst}%` }, el('span', { tekst: 'I dag' })));
  if (maaneder) bane.append(el('div', { class: 'sg-bane-mnd', 'aria-hidden': 'true' },
    f.maaneder.map((m) => el('span', { style: `left:${m.pst}%` }, m.tekst, m.aar ? el('em', { tekst: m.aar }) : null))));
  return bane;
}
export function tallBlokk(b) {
  return el('div', { class: 'sg-tall' },
    b.viktig ? el('div', { class: 'sg-tall-hoved' }, el('strong', { tekst: String(b.viktig.uker) }), el('span', {}, b.viktig.uker === 1 ? 'uke igjen' : 'uker igjen', el('em', { tekst: b.viktig.tekst }))) : null,
    el('div', { class: 'sg-tall-side' },
      b.neste ? el('p', { tekst: b.neste.tekst }) : null,
      b.uke ? el('p', { class: 'sg-uke', tekst: b.uke.tekst }) : null));
}
function tidslinjeSeksjon(k) {
  const x = seksjon('tidslinje', 'Tidslinje', 'Framdrift', 'Tidslinje');
  const b = tidslinje(k.milepaeler, k.innstillinger, k.idag);
  if (!b.liste.length) { x.sec.append(tom('Ingen milepæler er lagt inn.')); return x; }
  const topp = tallBlokk(b);
  topp.dataset.tabell = 'sg_innstillinger'; topp.dataset.id = String(k.innstillinger.id ?? 1);
  x.sec.append(topp, framdriftslinje(b.framdrift));
  x.sec.append(el('ol', { class: 'tl sg-tl' }, b.liste.map((r) => rad(el('li', { class: [r.status === 'ferdig' ? 'done' : r.status, r.viktig ? 'key' : '', r.neste ? 'neste' : ''].join(' ').trim() },
    el('b', {}, r.datoTekst, r.neste ? merke('Neste', 'neste') : null, r.status === 'pagar' ? merke(r.statusTekst, 'pagar') : null),
    el('span', { tekst: r.tekst }),
    r.relativ ? el('small', { class: 'sg-rel', tekst: stor(r.relativ) }) : null), 'sg_milepaeler', r.milepael))));
  return x;
}

/* 6. Beslutningslogg */
export function vedtakLinje(s) {
  return rad(el('li', { class: 'sg-vedtak' },
    el('time', { datetime: s.vedtatt || '', tekst: s.vedtatt ? datoTekst(s.vedtatt) : 'Uten dato' }),
    el('div', {}, el('strong', { tekst: s.tittel }), s.vedtak ? el('p', { tekst: s.vedtak }) : null)), 'sg_saker', s);
}
function beslutninger(k) {
  const x = seksjon('beslutninger', 'Beslutninger', 'Vedtatt', 'Beslutningslogg');
  const v = k.saker.filter((s) => s.status === 'besluttet').sort((a, b) => (b.vedtatt || '').localeCompare(a.vedtatt || ''));
  x.sec.append(v.length ? el('ol', { class: 'sg-logg' }, v.map(vedtakLinje)) : tom('Ingen vedtak ennå.'));
  return x;
}

/* 7. Risiko */
export const sorterRisiko = (a, b) => ((NIVAER[a.niva] || NIVAER.ikke_vurdert).rang - (NIVAER[b.niva] || NIVAER.ikke_vurdert).rang) || ((a.rekkefolge || 0) - (b.rekkefolge || 0));
function risikoSeksjon(k) {
  const x = seksjon('risiko', 'Risiko', 'Aktive risikoer', 'Risiko');
  const r = k.risikoer.filter((y) => y.aktiv !== false).sort(sorterRisiko);
  if (!r.length) { x.sec.append(tom('Ingen aktive risikoer.')); return x; }
  x.sec.append(el('ul', { class: 'sg-risikoer' }, r.map((y) => {
    const n = NIVAER[y.niva] || NIVAER.ikke_vurdert;
    return rad(el('li', { class: 'sg-risiko niva-' + (y.niva || 'ikke_vurdert') },
      el('span', { class: 'sg-niva', style: `--c:${n.css}`, tekst: n.navn }),
      el('div', {}, el('strong', { tekst: y.risiko }),
        y.tiltak ? el('p', {}, el('span', { class: 'sg-lbl', tekst: 'Tiltak: ' }), y.tiltak) : null,
        y.eier ? el('p', { class: 'sg-meta', tekst: 'Eier: ' + y.eier }) : null)), 'sg_risikoer', y);
  })));
  return x;
}

/* 8. Faste seksjoner */
const DYNAMISKE = new Set(['neste-mote', 'status', 'avklaring', 'aksjoner', 'tidslinje', 'beslutninger', 'risiko']);
function faste(k) {
  return k.seksjoner.slice().sort((a, b) => (a.rekkefolge ?? 0) - (b.rekkefolge ?? 0)).map((s) => {
    const nokkel = s.nokkel || String(s.id);
    const id = DYNAMISKE.has(nokkel) || !/^[a-z][a-z0-9_-]*$/i.test(nokkel) ? 'seksjon-' + nokkel.replace(/[^a-z0-9_-]/gi, '-') : nokkel;
    const x = seksjon(id, s.eyebrow || s.tittel || nokkel, s.eyebrow, s.tittel || '', { nokkel });
    rad(x.sec, 'sg_seksjoner', s);
    x.sec.append(...formSeksjon(trygHtml(s.html)));
    return x;
  });
}

/** Gjør rensket rik tekst om til innledning, områder, kort, åpen boks, merknad og lenkeliste (se kontrakten). */
export function formSeksjon(frag) {
  const ut = [];
  const noder = [...frag.childNodes].filter((n) => n.nodeType === 1 || (n.nodeType === 3 && n.nodeValue.trim()));
  let gruppe = null, kort = null, etterHr = false, harKort = false;
  const lukkGruppe = () => {
    if (gruppe && gruppe.children.length) {
      const n = gruppe.children.length;
      gruppe.className = 'cards ' + (n % 3 === 0 ? 'three' : 'two');
      ut.push(gruppe);
    }
    gruppe = null; kort = null;
  };
  const nyttKort = (tag) => {
    if (!gruppe) gruppe = el('div', { class: 'cards' });
    kort = el('div', { class: 'card' });
    if (tag) kort.append(el('span', { class: 'tag', tekst: tag }));
    gruppe.append(kort); harKort = true; etterHr = false;
    return kort;
  };
  for (let i = 0; i < noder.length; i++) {
    const n = noder[i];
    const tag = n.nodeType === 1 ? n.tagName : '#text';
    const neste = noder[i + 1];
    if (tag === 'H2') { lukkGruppe(); etterHr = false; harKort = false; ut.push(el('h3', { class: 'area', tekst: n.textContent })); continue; }
    if (tag === 'H4' && neste && neste.nodeType === 1 && neste.tagName === 'H3') {
      nyttKort(n.textContent); kort.append(el('h3', { tekst: neste.textContent })); i++; continue;
    }
    if (tag === 'H3' || tag === 'H4') { nyttKort(null); kort.append(el('h3', { tekst: n.textContent })); continue; }
    if (tag === 'HR') { lukkGruppe(); etterHr = true; continue; }
    if (tag === 'BLOCKQUOTE') {
      lukkGruppe();
      const boks = el('div', { class: 'open-box' });
      const forste = n.firstElementChild;
      const sterk = forste && forste.tagName === 'P' && forste.firstElementChild && ['STRONG', 'B'].includes(forste.firstElementChild.tagName) && forste.firstChild === forste.firstElementChild ? forste.firstElementChild : null;
      if (sterk) {
        boks.append(el('h3', { tekst: sterk.textContent }));
        sterk.remove();
        if (forste.firstChild && forste.firstChild.nodeName === 'BR') forste.firstChild.remove();
        if (!forste.textContent.trim()) forste.remove();
      }
      boks.append(...n.childNodes);
      ut.push(boks); continue;
    }
    if (kort && !etterHr) { kort.append(n); continue; }
    if ((tag === 'UL' || tag === 'OL') && n.children.length && [...n.children].every((li) => li.querySelector('a[href]'))) {
      lukkGruppe(); n.className = 'links'; ut.push(n); continue;
    }
    if (tag === 'P' || tag === '#text') {
      const p = tag === 'P' ? n : el('p', {}, n);
      p.className = etterHr || harKort ? 'note-line' : 'intro';
      lukkGruppe(); ut.push(p); continue;
    }
    lukkGruppe(); ut.push(n.nodeType === 1 && n.tagName !== 'P' ? el('div', { class: 'sg-rik' }, n) : n);
  }
  lukkGruppe();
  return ut;
}
