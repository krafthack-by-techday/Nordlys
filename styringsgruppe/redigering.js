// Redigering for styringsgruppe-siden (bare for redaktører).
// Alt fra databasen settes med textContent eller value, aldri som HTML.
import * as api from './api.js';

const CSS_URL = new URL('./redigering.css', import.meta.url).href;
const NOTAT_URL = new URL('./notat.js', import.meta.url).href;
const SIDE_URL = new URL('./', import.meta.url).href;
const LESER_NOKKEL = 'sg-se-som-leser'; // samme nøkkel som index.html

export const FARGE_NAVN = { gronn: 'Grønn', gul: 'Gul', rod: 'Rød', ikke_satt: 'Ikke satt' };
export const NIVA_NAVN = { hoy: 'Høy', middels: 'Middels', lav: 'Lav', ikke_vurdert: 'Ikke vurdert' };
export const STATUS_NAVN = { til_behandling: 'Til behandling', besluttet: 'Besluttet', utsatt: 'Utsatt' };
const FARGEVALG = Object.entries(FARGE_NAVN);
const NIVAVALG = Object.entries(NIVA_NAVN);
const STATUSVALG = Object.entries(STATUS_NAVN);
const STANDARD_STATUS = ['Styring, eierskap og forvaltning', 'Arkitektur og teknisk løsning', 'Krav, sikkerhet og testing', 'Ressurser', 'Økonomi'];
const PUBLISERT_TEKST = 'Publisert (synlig for styringsgruppen)';
const KONFLIKT_TEKST = 'Noen andre har endret dette mens du redigerte.';

/** Seksjonsnøkler (data-seksjon) som får egne knapper. Andre nøkler, og seksjoner med id «seksjon-…», regnes som faste seksjoner med «Rediger tekst». */
export const SEKSJONER = {
  'neste-mote': 'mote', neste_mote: 'mote', mote: 'mote', moter: 'mote',
  'til-avklaring': 'saker', til_avklaring: 'saker', avklaring: 'saker', saker: 'saker',
  aksjoner: 'aksjoner', aksjonspunkter: 'aksjoner',
  tidslinje: 'tidslinje', milepaeler: 'tidslinje',
  risiko: 'risiko', risikoer: 'risiko',
  status: 'ingen', beslutninger: 'ingen',
};

// ---------- små hjelpere ----------
const enc = encodeURIComponent;
const pad = (n) => String(n).padStart(2, '0');
const isoDato = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const idag = () => isoDato(new Date());
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
let teller = 0;
const uid = (p) => 'sgr-' + p + '-' + (++teller);

function datoTekst(iso) {
  if (!iso) return '';
  const d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
  return isNaN(d) ? String(iso) : d.toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Lager et element. Tekst settes alltid som tekst. */
function h(tag, props, ...barn) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'value') e.value = v;
    else if (k === 'checked') e.checked = !!v;
    else if (k === 'hidden') e.hidden = !!v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const b of barn.flat()) if (b != null && b !== false) e.append(b instanceof Node ? b : String(b));
  return e;
}
const knapp = (tekst, onclick, klasse = 'btn small', ekstra = {}) => h('button', { type: 'button', class: klasse, text: tekst, onclick, ...ekstra });

function stil() {
  if (document.querySelector('link[href$="redigering.css"]')) return;
  document.head.append(h('link', { rel: 'stylesheet', href: CSS_URL }));
}

async function hentRad(tabell, id) {
  return (await api.hent(tabell, 'id=eq.' + enc(id)))[0] || null;
}

function vert() { return document.fullscreenElement || document.body; }

/** Kort melding nederst på skjermen. Ligger i det øverste laget, så den vises også over dialoger. */
export function melding(tekst, feil = false) {
  let t = document.querySelector('.sgr-toast');
  if (!t || t.parentNode !== vert()) {
    t?.remove();
    t = h('div', { class: 'sgr-toast', role: 'status', 'aria-live': 'polite' });
    if ('popover' in HTMLElement.prototype) t.popover = 'manual';
    vert().append(t);
  }
  t.textContent = tekst;
  t.classList.toggle('sgr-toast-feil', feil);
  if (t.popover) { try { t.hidePopover(); } catch {} try { t.showPopover(); } catch {} }
  t.classList.add('sgr-vis');
  clearTimeout(t._tid);
  t._tid = setTimeout(() => { t.classList.remove('sgr-vis'); if (t.popover) { try { t.hidePopover(); } catch {} } }, 4000);
}

function kjor(fn) {
  return async (e) => {
    e?.preventDefault?.(); e?.stopPropagation?.();
    try { await fn(e); } catch (x) { console.error(x); melding(x.message || 'Noe gikk galt.', true); }
  };
}

// ---------- dialog ----------
function dialog({ tittel, stor = false } = {}) {
  stil();
  const forrigeFokus = document.activeElement;
  const tittelId = uid('t');
  const tittelEl = h('h2', { id: tittelId, text: tittel });
  const dlg = h('dialog', { class: 'sgr-dialog' + (stor ? ' sgr-stor' : ''), 'aria-labelledby': tittelId });
  const lukkK = h('button', { type: 'button', class: 'sgr-lukk', 'aria-label': 'Lukk', text: '×' });
  const hode = h('div', { class: 'sgr-hode' }, tittelEl, lukkK);
  const kropp = h('div', { class: 'sgr-kropp' });
  const fot = h('div', { class: 'sgr-fot' });
  dlg.append(hode, kropp, fot);
  let ok;
  const d = {
    dlg, hode, kropp, fot, tittelEl, resultat: null, lukket: false, foerLukk: null, avbryt: null,
    ferdig: new Promise((r) => { ok = r; }),
    lukk() {
      if (d.lukket) return;
      d.lukket = true;
      try { dlg.close(); } catch {}
      dlg.remove();
      d.vedLukk?.();
      ok(d.resultat);
      if (forrigeFokus && forrigeFokus.isConnected && forrigeFokus.focus) forrigeFokus.focus();
    },
    /** Lukker etter å ha spurt om ulagrede endringer. Gir true når dialogen ble lukket. */
    async forsok() {
      if (d.opptatt) return false;
      if (d.foerLukk) { d.opptatt = true; try { if (!(await d.foerLukk())) return false; } finally { d.opptatt = false; } }
      d.lukk();
      return true;
    },
  };
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    if (d.avbryt) { d.avbryt(); return; }
    d.forsok();
  });
  lukkK.addEventListener('click', () => d.forsok());
  vert().append(dlg);
  dlg.showModal();
  return d;
}

/** Bekreftelse inne i dialogen (i stedet for confirm()). Skjuler innholdet i `inn` mens spørsmålet vises. */
function bekreft(d, inn, tekst, jaTekst, neiTekst = 'Avbryt', fare = true) {
  return new Promise((svar) => {
    const nei = knapp(neiTekst);
    const ja = knapp(jaTekst, null, 'btn small ' + (fare ? 'sgr-fare' : 'primary'));
    const boks = h('div', { class: 'sgr-bekreft', role: 'alert' }, h('p', { text: tekst }), h('div', { class: 'sgr-knapper' }, nei, ja));
    const barn = [...inn.children];
    const var_skjult = barn.map((c) => c.hidden);
    barn.forEach((c) => { c.hidden = true; });
    inn.append(boks);
    const ferdig = (v) => {
      boks.remove();
      barn.forEach((c, i) => { c.hidden = var_skjult[i]; });
      if (d.avbryt === avbryt) d.avbryt = null;
      svar(v);
    };
    const avbryt = () => ferdig(false);
    d.avbryt = avbryt;
    nei.onclick = avbryt;
    ja.onclick = () => ferdig(true);
    nei.focus();
  });
}

function fotMedStatus(d) {
  const status = h('p', { class: 'sgr-status', role: 'status' });
  const knapper = h('div', { class: 'sgr-knapper' });
  d.fot.append(status, knapper);
  const sett = (t, feil = false) => { status.textContent = t || ''; status.classList.toggle('sgr-feil', feil); };
  return { status, knapper, sett };
}

// ---------- felt og skjema ----------
function lagFelt(def, verdi) {
  const id = uid(def.k);
  const wrap = h('div', { class: 'sgr-felt' + (def.bred ? ' sgr-bred' : '') + (def.t === 'check' ? ' sgr-felt-sjekk' : '') });
  const feilEl = h('p', { class: 'sgr-feilmelding', id: id + '-feil', hidden: true });
  let inp;
  if (def.t === 'check') {
    inp = h('input', { type: 'checkbox', id });
    wrap.append(h('label', { class: 'sgr-sjekk', for: id }, inp, h('span', { text: def.l })));
  } else {
    const lab = h('label', { for: id, text: def.l });
    if (def.valgfri) lab.append(h('span', { class: 'sgr-valgfri', text: ' (valgfritt)' }));
    if (def.t === 'textarea') inp = h('textarea', { id, rows: def.rader || 4, maxlength: def.maks || 5000 });
    else if (def.t === 'select') inp = h('select', { id }, def.valg.map(([v, n]) => h('option', { value: v, text: n })));
    else if (def.t === 'date') inp = h('input', { id, type: 'date' });
    else inp = h('input', { id, type: 'text', maxlength: def.maks || 300, autocomplete: 'off' });
    wrap.append(lab);
    if (def.hjelp) { const hid = id + '-hjelp'; wrap.append(h('p', { class: 'sgr-hjelp', id: hid, text: def.hjelp })); inp.setAttribute('aria-describedby', hid); }
    wrap.append(inp);
  }
  wrap.append(feilEl);
  if (def.t === 'select') inp.addEventListener('change', () => fargeKlasse(inp));
  const f = {
    def, wrap, inp,
    les() {
      if (def.t === 'check') return inp.checked;
      const v = inp.value.trim();
      return v === '' ? null : v;
    },
    sett(v) {
      if (def.t === 'check') inp.checked = !!v;
      else if (def.t === 'select') { inp.value = v ?? def.std ?? def.valg[0][0]; if (inp.selectedIndex < 0) inp.selectedIndex = 0; fargeKlasse(inp); }
      else inp.value = v ?? '';
    },
    feil(m) {
      feilEl.textContent = m || '';
      feilEl.hidden = !m;
      if (m) { inp.setAttribute('aria-invalid', 'true'); inp.setAttribute('aria-errormessage', feilEl.id); }
      else { inp.removeAttribute('aria-invalid'); inp.removeAttribute('aria-errormessage'); }
    },
  };
  f.sett(verdi);
  return f;
}

function fargeKlasse(sel) {
  sel.classList.forEach((c) => { if (c.startsWith('sgr-v-')) sel.classList.remove(c); });
  if (sel.value) sel.classList.add('sgr-v-' + sel.value);
}

function lagSkjema(defs, verdier = {}) {
  const el = h('div', { class: 'sgr-skjema' });
  const felter = defs.map((def) => lagFelt(def, verdier[def.k] !== undefined && verdier[def.k] !== null ? verdier[def.k] : def.std));
  felter.forEach((f) => el.append(f.wrap));
  const s = {
    el, felter,
    felt: (k) => felter.find((f) => f.def.k === k),
    alle() { const o = {}; for (const f of felter) o[f.def.k] = f.les(); return o; },
    verdier() { const o = {}; for (const f of felter) if (!f.wrap.hidden) o[f.def.k] = f.les(); return o; },
    synlighet() { const v = s.alle(); for (const f of felter) if (f.def.vis) f.wrap.hidden = !f.def.vis(v); },
    sett(rad) { for (const f of felter) f.sett(rad[f.def.k] ?? f.def.std); s.synlighet(); felter.forEach((f) => f.feil()); },
    valider() {
      let forste = null;
      const v = s.alle();
      for (const f of felter) {
        if (f.wrap.hidden) { f.feil(); continue; }
        const x = f.les();
        const maks = f.def.maks || (f.def.t === 'textarea' ? 5000 : 300);
        let m = null;
        if (f.def.paakrevd && (x == null || x === '')) m = f.def.t === 'date' ? 'Velg en dato.' : 'Fyll ut ' + f.def.l.toLowerCase() + '.';
        else if (typeof x === 'string' && f.def.t !== 'date' && x.length > maks) m = 'Maks ' + maks + ' tegn.';
        else if (f.def.sjekk) m = f.def.sjekk(x, v);
        f.feil(m);
        if (m && !forste) forste = f;
      }
      if (forste) { forste.inp.focus(); return null; }
      return s.verdier();
    },
  };
  el.addEventListener('change', () => s.synlighet());
  el.addEventListener('input', (e) => { const f = felter.find((x) => x.inp === e.target); if (f) f.feil(); });
  s.synlighet();
  return s;
}

async function moteValg(gjeldende) {
  let m = [];
  try { m = await api.hent('sg_moter', 'select=id,dato,tittel&order=dato.desc&limit=50'); } catch {}
  const valg = [['', 'Ikke knyttet til et møte'], ...m.map((x) => [x.id, datoTekst(x.dato) + ' – ' + x.tittel])];
  if (gjeldende && !m.some((x) => x.id === gjeldende)) valg.push([gjeldende, 'Et annet møte']);
  return valg;
}

const etterDato = (fra, tekst) => (x, v) => (x && v[fra] && x < v[fra] ? tekst : null);

const TABELLER = {
  sg_moter: {
    ent: 'møtet', ny: 'Nytt møte', rediger: 'Rediger møtet',
    felt: async () => [
      { k: 'dato', t: 'date', l: 'Dato', paakrevd: true },
      { k: 'tittel', t: 'text', l: 'Tittel', paakrevd: true, std: 'Styringsgruppemøte' },
      { k: 'sted', t: 'text', l: 'Sted', valgfri: true },
      { k: 'samlet_status', t: 'select', l: 'Samlet status', valg: FARGEVALG, std: 'ikke_satt' },
      { k: 'samlet_kommentar', t: 'textarea', l: 'Kommentar til samlet status', rader: 3 },
    ],
  },
  sg_status: {
    ent: 'statuslinjen', ny: 'Ny statuslinje', rediger: 'Rediger statuslinjen', publisert: false,
    felt: async () => [
      { k: 'navn', t: 'text', l: 'Område', paakrevd: true },
      { k: 'farge', t: 'select', l: 'Farge', valg: FARGEVALG, std: 'ikke_satt' },
      { k: 'kommentar', t: 'textarea', l: 'Kommentar', rader: 3 },
    ],
  },
  sg_saker: {
    ent: 'saken', ny: 'Ny sak', rediger: 'Rediger saken',
    felt: async (rad) => [
      { k: 'tittel', t: 'text', l: 'Tittel', paakrevd: true },
      { k: 'bakgrunn', t: 'textarea', l: 'Bakgrunn' },
      { k: 'anbefaling', t: 'textarea', l: 'Anbefaling', rader: 3 },
      { k: 'mote_id', t: 'select', l: 'Møte', valg: await moteValg(rad?.mote_id), std: '' },
      { k: 'status', t: 'select', l: 'Status', valg: STATUSVALG, std: 'til_behandling' },
      { k: 'vedtak', t: 'textarea', l: 'Vedtak', rader: 3, vis: (v) => v.status === 'besluttet' },
      { k: 'vedtatt', t: 'date', l: 'Vedtaksdato', std: idag(), vis: (v) => v.status === 'besluttet' },
    ],
  },
  sg_aksjoner: {
    ent: 'aksjonen', ny: 'Ny aksjon', rediger: 'Rediger aksjonen',
    felt: async (rad) => [
      { k: 'hva', t: 'textarea', l: 'Hva skal gjøres', rader: 2, maks: 300, paakrevd: true },
      { k: 'hvem', t: 'text', l: 'Hvem' },
      { k: 'frist', t: 'date', l: 'Frist' },
      { k: 'mote_id', t: 'select', l: 'Fra møte', valg: await moteValg(rad?.mote_id), std: '' },
      { k: 'ferdig', t: 'check', l: 'Ferdig' },
    ],
  },
  sg_risikoer: {
    ent: 'risikoen', ny: 'Ny risiko', rediger: 'Rediger risikoen',
    felt: async () => [
      { k: 'risiko', t: 'textarea', l: 'Risiko', rader: 2, maks: 300, paakrevd: true },
      { k: 'niva', t: 'select', l: 'Nivå', valg: NIVAVALG, std: 'ikke_vurdert' },
      { k: 'tiltak', t: 'textarea', l: 'Tiltak', rader: 3 },
      { k: 'eier', t: 'text', l: 'Eier' },
      { k: 'aktiv', t: 'check', l: 'Aktiv', std: true },
    ],
  },
  sg_milepaeler: {
    ent: 'milepælen', ny: 'Ny milepæl', rediger: 'Rediger milepælen',
    felt: async () => [
      { k: 'dato', t: 'date', l: 'Dato', paakrevd: true },
      { k: 'til', t: 'date', l: 'Til', valgfri: true, hjelp: 'Brukes for en periode.', sjekk: etterDato('dato', 'Må være etter datoen.') },
      { k: 'tekst', t: 'text', l: 'Tekst', paakrevd: true },
      { k: 'viktig', t: 'check', l: 'Viktig milepæl' },
    ],
  },
  sg_innstillinger: {
    ent: 'datoene', ny: 'Datoer for forprosjektet', rediger: 'Datoer for forprosjektet', publisert: false, kanSlettes: false,
    felt: async () => [
      { k: 'start', t: 'date', l: 'Start', paakrevd: true },
      { k: 'slutt', t: 'date', l: 'Slutt', paakrevd: true, sjekk: etterDato('start', 'Må være etter start.') },
    ],
  },
  sg_seksjoner: {
    ent: 'seksjonen', ny: 'Rediger tekst', rediger: 'Rediger tekst', rik: true, kanSlettes: false,
    felt: async () => [
      { k: 'eyebrow', t: 'text', l: 'Liten overskrift', valgfri: true },
      { k: 'tittel', t: 'text', l: 'Overskrift' },
    ],
  },
};

// ---------- rik tekst (notat.js) ----------
let notatLaster = null;
function lastNotat() {
  if (window.NordlysNotat) return Promise.resolve(window.NordlysNotat);
  if (!notatLaster) {
    notatLaster = new Promise((ferdig) => {
      const s = document.querySelector('script[src$="notat.js"]') || h('script', { src: NOTAT_URL });
      const slutt = () => ferdig(window.NordlysNotat || null);
      s.addEventListener('load', slutt, { once: true });
      s.addEventListener('error', () => ferdig(null), { once: true });
      if (!s.isConnected) document.head.append(s);
      setTimeout(slutt, 8000);
    });
  }
  return notatLaster;
}

async function rikTekst(foran, rad) {
  const id = uid('rik');
  const wrap = h('div', { class: 'sgr-felt sgr-rik' });
  foran.before(wrap);
  const N = await lastNotat();
  if (N && typeof N.aapneRikTekst === 'function') {
    const lid = id + '-l';
    const flate = h('div', { class: 'sgr-rik-flate', role: 'group', 'aria-labelledby': lid });
    wrap.append(h('span', { class: 'sgr-etikett', id: lid, text: 'Tekst' }), flate);
    try {
      const e = N.aapneRikTekst(flate, { doc: rad?.doc ?? null, html: rad?.html ?? '', plassholder: 'Skriv teksten her.' });
      return { wrap, html: () => e.html(), doc: () => (e.doc ? e.doc() : null), lukk: () => e.lukk?.() };
    } catch (x) { console.warn('Rik tekst feilet, bruker HTML-felt', x); wrap.replaceChildren(); }
  }
  const ta = h('textarea', { id, rows: 14, class: 'sgr-kode', spellcheck: 'false', value: rad?.html || '' });
  wrap.append(h('label', { for: id, text: 'Tekst (HTML)' }), h('p', { class: 'sgr-hjelp', text: 'Redigeringsverktøyet kunne ikke lastes, så teksten vises som HTML.' }), ta);
  return { wrap, html: () => ta.value, doc: () => null, lukk() {} };
}

// ---------- aapneSkjema ----------
/**
 * Åpner skjemaet for en rad. `rad` = null gir en ny rad.
 * valg: { tittel, ingress, felt: [nøkler], paakrevd: [nøkler], forhand: {verdier for ny rad}, fast: {verdier som alltid lagres}, utenPublisert }
 * Gir et løfte med den lagrede raden, { slettet: true } eller null.
 */
export async function aapneSkjema(tabell, rad = null, valg = {}) {
  const cfg = TABELLER[tabell];
  if (!cfg) throw new Error('Ukjent tabell: ' + tabell);
  let naa = rad && rad.id != null ? { ...rad } : null;
  const d = dialog({ tittel: valg.tittel || (naa ? cfg.rediger : cfg.ny) });
  const f = fotMedStatus(d);
  d.kropp.append(h('p', { class: 'sgr-laster', text: 'Laster …' }));

  let defs = await cfg.felt(naa);
  if (valg.felt) defs = defs.filter((x) => valg.felt.includes(x.k)).map((x) => ({ ...x, vis: undefined }));
  if (valg.paakrevd) defs = defs.map((x) => (valg.paakrevd.includes(x.k) ? { ...x, paakrevd: true } : x));
  if (cfg.publisert !== false && !valg.utenPublisert) defs.push({ k: 'publisert', t: 'check', l: PUBLISERT_TEKST, std: false });

  const skjema = lagSkjema(defs, { ...(valg.forhand || {}), ...(naa || {}) });
  const formId = uid('skjema');
  const form = h('form', { id: formId, novalidate: true }, skjema.el);
  const varsel = h('div', { class: 'sgr-varsel', role: 'alert', hidden: true });
  d.kropp.replaceChildren();
  if (valg.ingress) d.kropp.append(h('p', { class: 'sgr-ingress', text: valg.ingress }));
  d.kropp.append(varsel, form);

  let rik = null;
  const pubFelt = skjema.felt('publisert');
  const lagRik = async () => { rik = await rikTekst(pubFelt ? pubFelt.wrap : h('span'), naa); if (!pubFelt) skjema.el.append(rik.wrap); };
  if (cfg.rik) await lagRik();

  // snarveier for møtet
  if (tabell === 'sg_moter' && naa) d.kropp.append(moteSnarveier(d, () => naa, (ny) => { naa = { ...naa, ...ny }; }, f));

  const slettK = knapp('Slett', null, 'btn small sgr-fare-tekst', { hidden: !naa || cfg.kanSlettes === false });
  const avbrytK = knapp('Avbryt', () => d.forsok());
  const lagreK = h('button', { type: 'submit', form: formId, class: 'btn small primary', text: 'Lagre' });
  f.knapper.append(slettK, h('span', { class: 'sgr-flex' }), avbrytK, lagreK);

  const tilstand = () => JSON.stringify([skjema.alle(), rik ? rik.html() : null]);
  await new Promise((r) => requestAnimationFrame(r));
  let ren = tilstand();
  d.foerLukk = async () => tilstand() === ren || bekreft(d, d.fot, 'Du har endringer som ikke er lagret.', 'Lukk uten å lagre', 'Fortsett å redigere');
  d.vedLukk = () => rik?.lukk();

  let opptatt = false;
  async function lagreNa() {
    if (opptatt) return;
    const v = skjema.valider();
    if (!v) { f.sett('Rett feltet som er merket.', true); return; }
    const data = { ...v };
    if (rik) { data.html = rik.html(); data.doc = rik.doc(); }
    if (naa) { data.id = naa.id; if (naa.endret) data.endret = naa.endret; }
    else for (const [k, x] of Object.entries(valg.forhand || {})) if (!(k in data)) data[k] = x;
    Object.assign(data, valg.fast || {});
    let publiser = null;
    if (tabell === 'sg_moter' && 'publisert' in data) {
      if (naa ? data.publisert !== !!naa.publisert : data.publisert) publiser = data.publisert;
      if (naa) delete data.publisert; else data.publisert = false;
    }
    opptatt = true; lagreK.disabled = true; f.sett('Lagrer …');
    try {
      let lagret = await api.lagre(tabell, data);
      if (publiser !== null) {
        await api.rpc('sg_publiser_mote', { mote: lagret.id, publiser });
        lagret = { ...lagret, publisert: publiser };
        api.varsleEndring();
      }
      d.resultat = lagret;
      d.lukk();
      melding('Lagret.');
    } catch (e) {
      if (e instanceof api.KonfliktFeil) visKonflikt(e);
      else f.sett(e.message || 'Kunne ikke lagre.', true);
    } finally { opptatt = false; lagreK.disabled = false; }
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); lagreNa(); });
  form.addEventListener('input', () => { if (f.status.classList.contains('sgr-feil')) f.sett(''); });

  function visKonflikt(e) {
    f.sett('');
    const lastPaaNytt = async () => {
      const fersk = await hentRad(tabell, naa.id);
      if (!fersk) { varsel.replaceChildren(h('p', { text: 'Raden er slettet av noen andre.' })); return; }
      naa = fersk;
      skjema.sett(fersk);
      if (rik) { rik.lukk(); rik.wrap.remove(); await lagRik(); }
      await new Promise((r) => requestAnimationFrame(r));
      ren = tilstand();
      varsel.hidden = true;
      f.sett('Lastet inn på nytt.');
    };
    const behold = async () => {
      const fersk = await hentRad(tabell, naa.id);
      if (!fersk) { varsel.replaceChildren(h('p', { text: 'Raden er slettet av noen andre.' })); return; }
      naa.endret = fersk.endret;
      varsel.hidden = true;
      await lagreNa();
    };
    varsel.replaceChildren(
      h('p', { text: KONFLIKT_TEKST }),
      h('div', { class: 'sgr-knapper' }, knapp('Last inn på nytt', kjor(lastPaaNytt)), knapp('Behold mine endringer og lagre på nytt', kjor(behold), 'btn small primary')),
    );
    varsel.hidden = false;
    varsel.querySelector('button').focus();
  }

  slettK.addEventListener('click', async () => {
    if (!(await bekreft(d, d.fot, 'Slette ' + cfg.ent + '? Du kan angre under Historikk.', 'Slett'))) return;
    try {
      await api.slett(tabell, naa.id);
      d.resultat = { slettet: true, id: naa.id };
      d.lukk();
      melding('Slettet.');
    } catch (e) { f.sett(e.message, true); }
  });

  (skjema.felter.find((x) => x.def.t !== 'check')?.inp || lagreK).focus();
  return d.ferdig;
}

function moteSnarveier(d, mote, oppdater, f) {
  const boks = h('div', { class: 'sgr-ekstra' });
  const tegn = () => {
    const m = mote();
    const knapper = [knapp('Åpne veiviseren', kjor(async () => { if (await d.forsok()) forberedMote(m.id); }))];
    if (!m.avholdt) knapper.push(knapp('Avslutt møtet', kjor(async () => { if (await d.forsok()) avsluttMote(m.id); })));
    else {
      const pub = !m.referat_publisert;
      knapper.push(knapp(pub ? 'Publiser referat' : 'Trekk tilbake referatet', kjor(async () => {
        const lagret = await api.lagre('sg_moter', { id: m.id, endret: m.endret, referat_publisert: pub });
        oppdater(lagret);
        f.sett(pub ? 'Referatet er publisert.' : 'Referatet er trukket tilbake.');
        tegn();
      })));
    }
    boks.replaceChildren(...knapper);
  };
  tegn();
  return boks;
}

// ---------- registrerVedtak og nyAksjon (fungerer også over presentasjonen) ----------
export async function registrerVedtak(sakId) {
  const sak = await hentRad('sg_saker', sakId);
  if (!sak) { melding('Fant ikke saken.', true); return null; }
  return aapneSkjema('sg_saker', sak, {
    tittel: 'Registrer vedtak', ingress: sak.tittel, felt: ['vedtak', 'vedtatt'], paakrevd: ['vedtak', 'vedtatt'],
    fast: { status: 'besluttet' }, utenPublisert: true,
  });
}

export async function nyAksjon(moteId) {
  return aapneSkjema('sg_aksjoner', null, { tittel: 'Ny aksjon', felt: ['hva', 'hvem', 'frist'], forhand: { mote_id: moteId || null } });
}

// ---------- veiviser: forberedMote ----------
const AGENDA_STANDARD = ['status', 'risiko', 'aksjoner', 'tidslinje'];
const AGENDA_NAVN = { status: 'Status', risiko: 'Risiko', aksjoner: 'Aksjonspunkter', tidslinje: 'Tidslinje' };

function forrigeMerke(farge) {
  if (farge === undefined) return h('span', { class: 'sgr-forrige sgr-forrige-ny', text: 'Ny' });
  return h('span', { class: 'sgr-forrige' }, h('span', { class: 'sgr-prikk sgr-v-' + (farge || 'ikke_satt'), 'aria-hidden': 'true' }), 'Forrige: ' + (FARGE_NAVN[farge] || FARGE_NAVN.ikke_satt));
}
function fargeMerke(farge) {
  return h('span', { class: 'sgr-merke sgr-v-' + (farge || 'ikke_satt') }, h('span', { class: 'sgr-prikk', 'aria-hidden': 'true' }), FARGE_NAVN[farge] || FARGE_NAVN.ikke_satt);
}

export async function forberedMote(moteId = null) {
  const d = dialog({ tittel: moteId ? 'Forbered møtet' : 'Nytt møte', stor: true });
  d.dlg.classList.add('sgr-veiviser');
  const STEG = ['Møte og status', 'Saker', 'Agenda', 'Forhåndsvis og publiser'];
  const indikator = h('ol', { class: 'sgr-steg', 'aria-label': 'Steg' });
  d.hode.after(indikator);
  const varsel = h('div', { class: 'sgr-varsel', role: 'alert', hidden: true });
  const flate = h('div', { class: 'sgr-stegflate' });
  d.kropp.append(varsel, flate);
  const f = fotMedStatus(d);
  const tilbakeK = knapp('Tilbake', () => gaaTil(S.steg - 1));
  const nesteK = knapp('Neste', () => gaaTil(S.steg + 1), 'btn small primary');
  const utkastK = knapp('Lagre som utkast', () => avslutt(false));
  const publiserK = knapp('Publiser møtet', () => avslutt(true), 'btn small primary');
  f.knapper.append(tilbakeK, h('span', { class: 'sgr-flex' }), utkastK, publiserK, nesteK);

  const S = { steg: 0, mote: null, forrige: null, forrigeFarge: new Map(), linjer: [], slettes: [], utkast: null, agenda: null, saker: [] };
  let stegLagre = async () => true;
  let opptatt = false;

  async function last(id) {
    S.mote = id ? await hentRad('sg_moter', id) : null;
    const moter = await api.hent('sg_moter', 'order=dato.desc&limit=30');
    S.moter = moter;
    S.forrige = moter.find((m) => m.id !== S.mote?.id && (!S.mote?.dato || m.dato < S.mote.dato)) || null;
    const forrigeLinjer = S.forrige ? await api.hent('sg_status', 'mote_id=eq.' + enc(S.forrige.id) + '&order=rekkefolge.asc') : [];
    S.forrigeFarge = new Map(forrigeLinjer.map((l) => [norm(l.navn), l.farge || 'ikke_satt']));
    S.linjer = S.mote ? await api.hent('sg_status', 'mote_id=eq.' + enc(S.mote.id) + '&order=rekkefolge.asc') : [];
    S.linjer.forEach((l) => { l._sig = sig(l); });
    if (!S.linjer.length) {
      S.linjer = forrigeLinjer.length
        ? forrigeLinjer.map((l) => ({ navn: l.navn, farge: l.farge || 'ikke_satt', kommentar: l.kommentar ?? null }))
        : STANDARD_STATUS.map((navn) => ({ navn, farge: 'ikke_satt', kommentar: null }));
    }
    S.slettes = [];
    S.agenda = null;
    S.utkast = S.mote || {
      dato: null, tittel: 'Styringsgruppemøte', sted: S.forrige?.sted ?? null,
      samlet_status: S.forrige?.samlet_status || 'ikke_satt', samlet_kommentar: S.forrige?.samlet_kommentar ?? null,
    };
  }
  const sig = (l) => JSON.stringify([l.navn, l.farge || 'ikke_satt', l.kommentar ?? null, l.rekkefolge ?? 0]);

  function settKnapper() {
    tilbakeK.hidden = S.steg === 0;
    nesteK.hidden = S.steg === 3;
    utkastK.hidden = publiserK.hidden = S.steg !== 3;
    if (S.mote?.publisert) { utkastK.textContent = 'Gjør til utkast'; publiserK.textContent = 'Lagre og lukk'; }
    else { utkastK.textContent = 'Lagre som utkast'; publiserK.textContent = 'Publiser møtet'; }
    indikator.replaceChildren(...STEG.map((navn, i) => {
      const b = h('button', { type: 'button', disabled: !S.mote && i > 0, onclick: () => gaaTil(i) }, h('span', { class: 'sgr-steg-nr', text: String(i + 1) }), h('span', { class: 'sgr-steg-navn', text: navn }));
      if (i === S.steg) b.setAttribute('aria-current', 'step');
      return h('li', { class: i === S.steg ? 'sgr-naa' : i < S.steg ? 'sgr-gjort' : '' }, b);
    }));
  }

  function visFeil(e) {
    if (e instanceof api.KonfliktFeil) {
      varsel.replaceChildren(h('p', { text: KONFLIKT_TEKST }), h('div', { class: 'sgr-knapper' }, knapp('Last inn på nytt', kjor(async () => {
        varsel.hidden = true; await last(S.mote?.id); await tegn();
      }), 'btn small primary')));
      varsel.hidden = false;
      varsel.querySelector('button').focus();
      f.sett('');
    } else f.sett(e.message || 'Kunne ikke lagre.', true);
  }

  async function lagreSteg() {
    const ok = await stegLagre();
    if (!ok) f.sett('Rett feltet som er merket.', true);
    return ok;
  }

  async function gaaTil(n) {
    if (opptatt || n < 0 || n > 3 || n === S.steg) return;
    opptatt = true; f.sett('Lagrer …');
    [tilbakeK, nesteK].forEach((b) => { b.disabled = true; });
    try {
      if (!(await lagreSteg())) return;
      f.sett('Lagret.');
      S.steg = n;
      await tegn();
    } catch (e) { visFeil(e); }
    finally { opptatt = false; [tilbakeK, nesteK].forEach((b) => { b.disabled = false; }); }
  }

  async function avslutt(publiser) {
    if (opptatt) return;
    opptatt = true;
    try {
      if (!(await lagreSteg())) return;
      if (publiser) await api.rpc('sg_publiser_mote', { mote: S.mote.id, publiser: true });
      else if (S.mote.publisert) await api.rpc('sg_publiser_mote', { mote: S.mote.id, publiser: false });
      api.varsleEndring();
      const tekst = publiser ? (S.mote.publisert ? 'Lagret.' : 'Møtet er publisert.') : 'Lagret som utkast.';
      d.resultat = S.mote.id;
      d.lukk();
      melding(tekst);
    } catch (e) { visFeil(e); }
    finally { opptatt = false; }
  }

  d.foerLukk = async () => {
    try { if (await stegLagre()) { d.resultat = S.mote?.id ?? null; return true; } }
    catch (e) { visFeil(e); return false; }
    return bekreft(d, d.fot, 'Det du har skrevet i dette steget, er ikke lagret.', 'Lukk uten å lagre', 'Fortsett å redigere');
  };

  async function tegn() {
    settKnapper();
    stegLagre = async () => true;
    flate.replaceChildren(h('p', { class: 'sgr-laster', text: 'Laster …' }));
    const overskrift = h('h3', { class: 'sgr-stegtittel', tabindex: '-1', text: STEG[S.steg] });
    const innhold = await [steg1, steg2, steg3, steg4][S.steg]();
    flate.replaceChildren(overskrift, ...[].concat(innhold).filter(Boolean));
    settKnapper();
    const forste = flate.querySelector('input:not([type=checkbox]), select, textarea');
    (S.steg === 0 && forste ? forste : overskrift).focus();
    flate.scrollTop = 0;
    d.kropp.scrollTop = 0;
  }

  // Steg 1: møte og status
  async function steg1() {
    const m = S.mote || S.utkast;
    const grunn = lagSkjema([
      { k: 'dato', t: 'date', l: 'Dato', paakrevd: true },
      { k: 'tittel', t: 'text', l: 'Tittel', paakrevd: true, std: 'Styringsgruppemøte' },
      { k: 'sted', t: 'text', l: 'Sted', valgfri: true },
    ], m);
    grunn.el.classList.add('sgr-rad3');
    const samlet = lagSkjema([
      { k: 'samlet_status', t: 'select', l: 'Samlet status', valg: FARGEVALG, std: 'ikke_satt' },
      { k: 'samlet_kommentar', t: 'textarea', l: 'Kommentar', rader: 2 },
    ], m);
    samlet.el.classList.add('sgr-samlet');
    if (S.forrige) samlet.felt('samlet_status').wrap.append(forrigeMerke(S.forrige.samlet_status || 'ikke_satt'));

    const liste = h('ol', { class: 'sgr-linjer' });
    const tegnLinjer = () => liste.replaceChildren(...S.linjer.map((l) => linjeRad(l)));
    function linjeRad(l) {
      const idN = uid('omr'), idF = uid('farge'), idK = uid('kom');
      const navn = h('input', { id: idN, type: 'text', maxlength: 300, value: l.navn || '', autocomplete: 'off' });
      const farge = h('select', { id: idF }, FARGEVALG.map(([v, n]) => h('option', { value: v, text: n })));
      farge.value = l.farge || 'ikke_satt'; fargeKlasse(farge);
      const kom = h('textarea', { id: idK, rows: 1, maxlength: 5000, value: l.kommentar || '' });
      let forrige = S.forrige ? forrigeMerke(S.forrigeFarge.get(norm(l.navn))) : h('span');
      const fjern = knapp('Fjern', () => { if (l.id) S.slettes.push(l); S.linjer.splice(S.linjer.indexOf(l), 1); tegnLinjer(); }, 'sgr-tekstknapp', { 'aria-label': 'Fjern ' + (l.navn || 'linjen') });
      navn.addEventListener('input', () => {
        l.navn = navn.value;
        fjern.setAttribute('aria-label', 'Fjern ' + (l.navn || 'linjen'));
        if (S.forrige) { const ny = forrigeMerke(S.forrigeFarge.get(norm(l.navn))); forrige.replaceWith(ny); forrige = ny; }
      });
      farge.addEventListener('change', () => { l.farge = farge.value; fargeKlasse(farge); });
      kom.addEventListener('input', () => { l.kommentar = kom.value; });
      return h('li', { class: 'sgr-linjerad' },
        h('div', { class: 'sgr-c-navn' }, h('label', { for: idN, class: 'sgr-mini', text: 'Område' }), navn),
        h('div', { class: 'sgr-c-farge' }, h('label', { for: idF, class: 'sgr-mini', text: 'Farge' }), h('div', { class: 'sgr-farge-rad' }, farge, forrige)),
        h('div', { class: 'sgr-c-kom' }, h('label', { for: idK, class: 'sgr-mini', text: 'Kommentar' }), kom),
        h('div', { class: 'sgr-c-fjern' }, fjern));
    }
    tegnLinjer();
    const leggTil = knapp('Legg til område', () => {
      S.linjer.push({ navn: '', farge: 'ikke_satt', kommentar: null });
      tegnLinjer();
      liste.lastElementChild.querySelector('input').focus();
    });

    stegLagre = async () => {
      const v = grunn.valider();
      if (!v) return false;
      const data = { ...v, samlet_status: samlet.felt('samlet_status').les() || 'ikke_satt', samlet_kommentar: samlet.felt('samlet_kommentar').les() };
      if (!S.mote) S.mote = await api.lagre('sg_moter', { ...data, agenda: [], publisert: false });
      else if (Object.keys(data).some((k) => (data[k] ?? null) !== (S.mote[k] ?? null))) S.mote = await api.lagre('sg_moter', { id: S.mote.id, endret: S.mote.endret, ...data });
      S.utkast = S.mote;
      const beholdes = [];
      for (const l of S.linjer) {
        if (!(l.navn || '').trim()) { if (l.id) S.slettes.push(l); continue; }
        beholdes.push(l);
      }
      for (const [i, l] of beholdes.entries()) {
        const rad = { navn: l.navn.trim(), farge: l.farge || 'ikke_satt', kommentar: (l.kommentar || '').trim() || null, rekkefolge: i };
        if (!l.id) Object.assign(l, await api.lagre('sg_status', { mote_id: S.mote.id, ...rad }));
        else if (l._sig !== sig(rad)) Object.assign(l, await api.lagre('sg_status', { id: l.id, endret: l.endret, ...rad }));
        l._sig = sig(l);
      }
      for (const l of S.slettes.splice(0)) await api.slett('sg_status', l.id);
      S.linjer = beholdes;
      return true;
    };

    return [
      grunn.el,
      h('fieldset', { class: 'sgr-gruppe' }, h('legend', { text: 'Samlet status' }), samlet.el),
      h('fieldset', { class: 'sgr-gruppe' }, h('legend', { text: 'Status per område' }),
        S.forrige ? h('p', { class: 'sgr-hjelp', text: 'Hentet fra møtet ' + datoTekst(S.forrige.dato) + '. Endre det som er nytt.' }) : null,
        liste, leggTil),
    ];
  }

  // Steg 2: saker
  async function steg2() {
    const alle = await api.hent('sg_saker', 'status=eq.til_behandling&order=tittel.asc');
    S.saker = alle.map((s) => ({ ...s, _valgt: s.mote_id === S.mote.id }));
    const moteNavn = new Map((S.moter || []).map((m) => [m.id, datoTekst(m.dato)]));
    const liste = h('ul', { class: 'sgr-sakliste' });
    const tegnListe = () => {
      if (!S.saker.length) { liste.replaceChildren(h('li', { class: 'sgr-tom', text: 'Ingen saker venter på behandling.' })); return; }
      liste.replaceChildren(...S.saker.map((s) => {
        const id = uid('sak');
        const boks = h('input', { type: 'checkbox', id, checked: s._valgt, onchange: (e) => { s._valgt = e.target.checked; } });
        const meta = s.mote_id && s.mote_id !== S.mote.id ? 'Står på møtet ' + (moteNavn.get(s.mote_id) || 'et annet møte') + '. Flyttes hit hvis du krysser av.' : null;
        return h('li', {}, h('label', { class: 'sgr-sjekk', for: id }, boks, h('span', {}, h('span', { class: 'sgr-sak-tittel', text: s.tittel }), meta ? h('span', { class: 'sgr-hjelp', text: meta }) : null)));
      }));
    };
    tegnListe();

    const ny = lagSkjema([
      { k: 'tittel', t: 'text', l: 'Tittel', paakrevd: true },
      { k: 'bakgrunn', t: 'textarea', l: 'Bakgrunn', rader: 3 },
      { k: 'anbefaling', t: 'textarea', l: 'Anbefaling', rader: 2 },
    ]);
    const leggTil = async () => {
      const v = ny.valider();
      if (!v) return false;
      const lagret = await api.lagre('sg_saker', { ...v, mote_id: S.mote.id, status: 'til_behandling', publisert: false });
      S.saker.push({ ...lagret, _valgt: true });
      ny.sett({});
      tegnListe();
      f.sett('Saken «' + lagret.tittel + '» er lagt til.');
      return true;
    };
    const leggTilK = knapp('Legg til saken', kjor(async () => { if (!(await leggTil())) f.sett('Rett feltet som er merket.', true); }));

    stegLagre = async () => {
      if (ny.felt('tittel').les() && !(await leggTil())) return false;
      for (const s of S.saker) {
        const skal = s._valgt ? S.mote.id : (s.mote_id === S.mote.id ? null : s.mote_id);
        if (skal !== (s.mote_id ?? null)) Object.assign(s, await api.lagre('sg_saker', { id: s.id, endret: s.endret, mote_id: skal }));
      }
      return true;
    };

    return [
      h('p', { class: 'sgr-hjelp', text: 'Kryss av for sakene som skal behandles på dette møtet.' }),
      liste,
      h('fieldset', { class: 'sgr-gruppe' }, h('legend', { text: 'Ny sak' }), ny.el, leggTilK),
    ];
  }

  // Steg 3: agenda
  async function steg3() {
    const saker = await api.hent('sg_saker', 'mote_id=eq.' + enc(S.mote.id) + '&order=tittel.asc');
    const sakMap = new Map(saker.map((s) => [s.id, s]));
    let liste;
    if (S.agenda) liste = S.agenda;
    else {
      const lagret = Array.isArray(S.mote.agenda) ? S.mote.agenda : [];
      liste = lagret.length
        ? lagret.map((p) => ({ ...p, med: true }))
        : [{ type: 'status', med: true }, { type: 'risiko', med: true }, { type: 'aksjoner', med: true }, { type: 'tidslinje', med: true }];
    }
    liste = liste.filter((p) => p.type !== 'sak' || sakMap.has(p.sak_id));
    for (const s of saker) {
      if (liste.some((p) => p.type === 'sak' && p.sak_id === s.id)) continue;
      let i = liste.map((p) => p.type).lastIndexOf('sak');
      if (i < 0) i = liste.findIndex((p) => p.type === 'status');
      liste.splice(i + 1, 0, { type: 'sak', sak_id: s.id, med: true });
    }
    for (const t of AGENDA_STANDARD) if (!liste.some((p) => p.type === t)) liste.push({ type: t, med: false });
    S.agenda = liste;

    const navn = (p) => (p.type === 'sak' ? 'Sak: ' + (sakMap.get(p.sak_id)?.tittel || '') : p.type === 'fritt' ? (p.tekst || 'Fritt punkt') : AGENDA_NAVN[p.type]);
    const ol = h('ol', { class: 'sgr-agenda' });
    const tegnListe = (fokus) => {
      ol.replaceChildren(...liste.map((p, i) => {
        const id = uid('ag');
        const boks = h('input', { type: 'checkbox', id, checked: p.med, onchange: (e) => { p.med = e.target.checked; } });
        let hoved;
        if (p.type === 'fritt') {
          const tid = uid('fritt');
          boks.setAttribute('aria-label', 'Ta med');
          const inp = h('input', { id: tid, type: 'text', maxlength: 300, value: p.tekst || '', placeholder: 'Eventuelt', oninput: (e) => {
            p.tekst = e.target.value;
            const li = e.target.closest('li');
            li.querySelector('[data-hva="opp"]').setAttribute('aria-label', 'Flytt opp: ' + navn(p));
            li.querySelector('[data-hva="ned"]').setAttribute('aria-label', 'Flytt ned: ' + navn(p));
          } });
          hoved = h('div', { class: 'sgr-ag-fritt' }, boks, h('label', { for: tid, class: 'sgr-sr', text: 'Fritt punkt' }), inp);
        } else hoved = h('label', { class: 'sgr-sjekk', for: id }, boks, h('span', { text: navn(p) }));
        const flytt = (til, hva) => () => { liste.splice(i, 1); liste.splice(til, 0, p); tegnListe({ indeks: til, hva }); };
        const opp = knapp('↑', flytt(i - 1, 'opp'), 'sgr-ikon', { 'aria-label': 'Flytt opp: ' + navn(p), disabled: i === 0, 'data-hva': 'opp' });
        const ned = knapp('↓', flytt(i + 1, 'ned'), 'sgr-ikon', { 'aria-label': 'Flytt ned: ' + navn(p), disabled: i === liste.length - 1, 'data-hva': 'ned' });
        const fjern = p.type === 'fritt' ? knapp('Fjern', () => { liste.splice(i, 1); tegnListe(); }, 'sgr-tekstknapp', { 'aria-label': 'Fjern punktet' }) : null;
        return h('li', { class: p.med ? '' : 'sgr-av' }, hoved, h('div', { class: 'sgr-ag-knapper' }, fjern, opp, ned));
      }));
      if (fokus) {
        const li = ol.children[fokus.indeks];
        const b = li?.querySelector('[data-hva="' + fokus.hva + '"]:not([disabled])') || li?.querySelector('.sgr-ikon:not([disabled])');
        b?.focus();
      }
    };
    ol.addEventListener('change', (e) => { if (e.target.type === 'checkbox') e.target.closest('li').classList.toggle('sgr-av', !e.target.checked); });
    tegnListe();
    const leggTil = knapp('Legg til punkt', () => {
      liste.push({ type: 'fritt', tekst: '', med: true });
      tegnListe();
      ol.lastElementChild.querySelector('input[type=text]').focus();
    });

    stegLagre = async () => {
      const agenda = liste.filter((p) => p.med && (p.type !== 'fritt' || (p.tekst || '').trim()))
        .map((p) => (p.type === 'sak' ? { type: 'sak', sak_id: p.sak_id } : p.type === 'fritt' ? { type: 'fritt', tekst: p.tekst.trim() } : { type: p.type }));
      if (JSON.stringify(agenda) !== JSON.stringify(S.mote.agenda || [])) S.mote = await api.lagre('sg_moter', { id: S.mote.id, endret: S.mote.endret, agenda });
      return true;
    };
    return [h('p', { class: 'sgr-hjelp', text: 'Fjern avkrysningen for punkter som ikke skal med.' }), ol, leggTil];
  }

  // Steg 4: forhåndsvis og publiser
  async function steg4() {
    S.mote = await hentRad('sg_moter', S.mote.id) || S.mote;
    const saker = await api.hent('sg_saker', 'mote_id=eq.' + enc(S.mote.id) + '&order=tittel.asc');
    const sakMap = new Map(saker.map((s) => [s.id, s]));
    const m = S.mote;
    const agenda = (m.agenda || []).map((p) => (p.type === 'sak' ? 'Sak: ' + (sakMap.get(p.sak_id)?.tittel || '') : p.type === 'fritt' ? p.tekst : AGENDA_NAVN[p.type]));
    const sakerPaaAgenda = (m.agenda || []).filter((p) => p.type === 'sak').map((p) => sakMap.get(p.sak_id)).filter(Boolean);
    const oppsummering = h('div', { class: 'sgr-oppsummering' },
      h('div', { class: 'sgr-opp-hode' },
        h('p', { class: 'sgr-opp-dato', text: [datoTekst(m.dato), m.sted].filter(Boolean).join(' · ') }),
        h('h4', { text: m.tittel }),
        h('div', { class: 'sgr-opp-samlet' }, fargeMerke(m.samlet_status), m.samlet_kommentar ? h('p', { text: m.samlet_kommentar }) : null)),
      h('h5', { text: 'Status' }),
      h('ul', { class: 'sgr-opp-status' }, S.linjer.map((l) => h('li', {}, fargeMerke(l.farge), h('span', { class: 'sgr-opp-navn', text: l.navn }), l.kommentar ? h('span', { class: 'sgr-hjelp', text: l.kommentar }) : null))),
      h('h5', { text: 'Agenda' }),
      agenda.length ? h('ol', { class: 'sgr-opp-agenda' }, agenda.map((t) => h('li', { text: t }))) : h('p', { class: 'sgr-hjelp', text: 'Ingen punkter.' }),
      sakerPaaAgenda.length ? h('h5', { text: 'Saker til behandling' }) : null,
      sakerPaaAgenda.map((s) => h('div', { class: 'sgr-opp-sak' }, h('p', { class: 'sgr-sak-tittel', text: s.tittel }),
        s.bakgrunn ? h('p', {}, h('b', { text: 'Bakgrunn: ' }), s.bakgrunn) : null,
        s.anbefaling ? h('p', {}, h('b', { text: 'Anbefaling: ' }), s.anbefaling) : null)),
    );
    const tilstand = m.publisert ? 'Møtet er publisert og synlig for styringsgruppen.' : 'Møtet er et utkast. Bare redaktører ser det.';
    const forhaand = knapp('Forhåndsvis lysbilder', () => window.open(SIDE_URL + '#presenter/' + enc(m.id), '_blank', 'noopener'));
    return [h('p', { class: 'sgr-hjelp', text: tilstand }), oppsummering, h('div', { class: 'sgr-knapper' }, forhaand)];
  }

  flate.append(h('p', { class: 'sgr-laster', text: 'Laster …' }));
  try { await last(moteId); await tegn(); } catch (e) { visFeil(e); }
  return d.ferdig;
}

// ---------- vedtak og aksjoner i notatet ----------
const MANEDER = { jan: 1, januar: 1, feb: 2, februar: 2, mar: 3, mars: 3, apr: 4, april: 4, mai: 5, jun: 6, juni: 6, jul: 7, juli: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, nov: 11, november: 11, des: 12, desember: 12 };

/** Stabil hash av en notatlinje (FNV-1a, 32 bit). Små og store bokstaver og ekstra mellomrom teller ikke. */
export function notatRef(linje) {
  const s = String(linje || '').trim().replace(/\s+/g, ' ').toLowerCase();
  let x = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
  return 'n1-' + x.toString(16).padStart(8, '0');
}

function lagDato(aar, mnd, dag) {
  const d = new Date(aar, mnd - 1, dag, 12);
  return d.getMonth() === mnd - 1 && d.getDate() === dag ? isoDato(d) : null;
}
function nesteForekomst(mnd, dag, aar, idagD) {
  if (aar) return lagDato(aar < 100 ? 2000 + aar : aar, mnd, dag);
  const iso = isoDato(idagD);
  const y = idagD.getFullYear();
  const denne = lagDato(y, mnd, dag);
  if (denne && denne >= iso) return denne;
  return lagDato(y + 1, mnd, dag) || (mnd === 2 && dag === 29 ? lagDato(y + 4 - (y % 4), 2, 29) : null);
}
function finnFrist(s, idagD) {
  let m = /\binnen\s+(\d{1,2})\.\s?(\d{1,2})(?:\.\s?(\d{4}|\d{2})(?!\d))?(?![\d])/i.exec(s);
  if (m) { const dato = nesteForekomst(+m[2], +m[1], m[3] ? +m[3] : null, idagD); if (dato) return { dato, treff: m[0] }; }
  m = /\binnen\s+(\d{1,2})\.?\s+([a-zæøå]+)\.?(?:\s+(\d{4}))?/i.exec(s);
  if (m && MANEDER[m[2].toLowerCase()]) { const dato = nesteForekomst(MANEDER[m[2].toLowerCase()], +m[1], m[3] ? +m[3] : null, idagD); if (dato) return { dato, treff: m[0] }; }
  return null;
}
const stor = (o) => o.split(/([\s-])/).map((d) => (d.length > 1 || /\p{L}/u.test(d) ? d.charAt(0).toUpperCase() + d.slice(1) : d)).join('');
function finnHvem(s) {
  const m = /@([\p{L}][\p{L}'’-]*(?:\.[\p{L}][\p{L}'’-]*)*)(?:\s+(\p{Lu}[\p{L}'’-]*))?/u.exec(s);
  if (!m) return null;
  let navn = m[1].split('.').map(stor).join(' ');
  let treff = '@' + m[1];
  if (m[2] && m[2].toLowerCase() !== 'innen' && !m[1].includes('.')) { navn += ' ' + m[2]; treff = m[0]; }
  return { navn, treff };
}
function rensAksjon(innhold, frist, hvem) {
  let t = innhold;
  if (frist) t = t.replace(frist.treff, ' ');
  if (hvem) {
    const i = t.indexOf(hvem.treff);
    const foer = t.slice(0, i), etter = t.slice(i + hvem.treff.length);
    const tom = (x) => !x.replace(/[\s,;:.–-]/g, '');
    if (tom(foer)) t = etter;
    else if (tom(etter)) t = foer;
    else t = foer + hvem.treff.slice(1) + etter;
  }
  t = t.replace(/\s+/g, ' ').replace(/\s+([,.;:])/g, '$1').replace(/^[\s,;:–-]+|[\s,.;:–-]+$/g, '');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : innhold.trim();
}

/**
 * Finner linjer som starter med «Vedtak:» eller «Aksjon:» (uansett store og små bokstaver, også i lister).
 * Gir [{ type: 'vedtak'|'aksjon', linje, ref, tekst, hvem?, frist? }]. Like linjer kommer bare med én gang.
 */
export function finnVedtakOgAksjoner(tekst, idagD = new Date()) {
  const ut = [];
  const sett = new Set();
  for (const raa of String(tekst || '').split(/\r?\n/)) {
    const m = /^\s*(?:[-*•–]\s*|\d+[.)]\s+)?(vedtak|aksjon)\s*:\s*(\S.*?)\s*$/i.exec(raa);
    if (!m) continue;
    const linje = raa.trim();
    const ref = notatRef(linje);
    if (sett.has(ref)) continue;
    sett.add(ref);
    const type = m[1].toLowerCase();
    if (type === 'vedtak') { ut.push({ type, linje, ref, tekst: m[2] }); continue; }
    const frist = finnFrist(m[2], idagD);
    const hvem = finnHvem(frist ? m[2].replace(frist.treff, ' ') : m[2]);
    ut.push({ type, linje, ref, tekst: rensAksjon(m[2], frist, hvem), hvem: hvem ? hvem.navn : null, frist: frist ? frist.dato : null });
  }
  return ut;
}

function kortTittel(t, maks = 80) {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  if (s.length <= maks) return s;
  const kutt = s.slice(0, maks);
  return kutt.slice(0, kutt.lastIndexOf(' ') > 30 ? kutt.lastIndexOf(' ') : maks) + ' …';
}

export async function avsluttMote(moteId) {
  const d = dialog({ tittel: 'Avslutt møtet', stor: true });
  const f = fotMedStatus(d);
  d.kropp.append(h('p', { class: 'sgr-laster', text: 'Laster …' }));
  let mote, notat, saker, lagredeAksjoner;
  try {
    [mote, notat, saker, lagredeAksjoner] = await Promise.all([
      hentRad('sg_moter', moteId),
      api.hent('sg_notater', 'mote_id=eq.' + enc(moteId) + '&select=tekst').then((r) => r[0] || null),
      api.hent('sg_saker', 'mote_id=eq.' + enc(moteId) + '&order=tittel.asc'),
      api.hent('sg_aksjoner', 'mote_id=eq.' + enc(moteId) + '&notat_ref=not.is.null&select=notat_ref'),
    ]);
  } catch (e) { d.kropp.replaceChildren(h('p', { class: 'sgr-feil', text: e.message })); f.knapper.append(knapp('Lukk', () => d.lukk())); return d.ferdig; }
  if (!mote) { d.kropp.replaceChildren(h('p', { text: 'Fant ikke møtet.' })); f.knapper.append(knapp('Lukk', () => d.lukk())); return d.ferdig; }

  const lagrede = new Set([...saker.map((s) => s.notat_ref), ...lagredeAksjoner.map((a) => a.notat_ref)].filter(Boolean));
  const funn = finnVedtakOgAksjoner(notat?.tekst || '');
  const rader = [];

  const liste = h('ol', { class: 'sgr-funnliste' });
  for (const x of funn) {
    const ferdig = lagrede.has(x.ref);
    const li = h('li', { class: 'sgr-funn' + (ferdig ? ' sgr-ferdig' : '') });
    const hode = h('div', { class: 'sgr-funn-hode' }, h('span', { class: 'sgr-type sgr-type-' + x.type, text: x.type === 'vedtak' ? 'Vedtak' : 'Aksjon' }));
    const sitat = h('p', { class: 'sgr-sitat', text: x.linje });
    li.append(hode);
    if (ferdig) { hode.append(h('span', { class: 'sgr-lagret', text: 'Allerede lagret' })); li.append(sitat); liste.append(li); continue; }
    const bid = uid('ta');
    const boks = h('input', { type: 'checkbox', id: bid, checked: true });
    hode.append(h('label', { class: 'sgr-sjekk sgr-ta-med', for: bid }, boks, h('span', { text: 'Lagre' })));
    li.append(sitat);
    let skjema;
    if (x.type === 'vedtak') {
      const lav = norm(x.linje);
      const treff = saker.filter((s) => norm(s.tittel).length >= 3 && lav.includes(norm(s.tittel))).sort((a, b) => b.tittel.length - a.tittel.length)[0];
      skjema = lagSkjema([
        { k: 'vedtak', t: 'textarea', l: 'Vedtak', rader: 2, paakrevd: true, bred: true },
        { k: 'sak', t: 'select', l: 'Sak', valg: [...saker.map((s) => [s.id, s.tittel]), ['ny', 'Ny besluttet sak']] },
        { k: 'tittel', t: 'text', l: 'Tittel på saken', paakrevd: true, vis: (v) => v.sak === 'ny' },
      ], { vedtak: x.tekst, sak: treff ? treff.id : 'ny', tittel: kortTittel(x.tekst) });
    } else {
      skjema = lagSkjema([
        { k: 'hva', t: 'textarea', l: 'Hva', rader: 2, maks: 300, paakrevd: true, bred: true },
        { k: 'hvem', t: 'text', l: 'Hvem' },
        { k: 'frist', t: 'date', l: 'Frist' },
      ], { hva: x.tekst, hvem: x.hvem, frist: x.frist });
    }
    skjema.el.classList.add('sgr-rad2');
    boks.addEventListener('change', () => { li.classList.toggle('sgr-av', !boks.checked); skjema.el.hidden = !boks.checked; });
    li.append(skjema.el);
    liste.append(li);
    rader.push({ x, boks, skjema });
  }

  const antV = funn.filter((x) => x.type === 'vedtak').length, antA = funn.length - antV;
  const ingress = funn.length
    ? 'Fant ' + antV + ' vedtak og ' + antA + (antA === 1 ? ' aksjon' : ' aksjoner') + ' i notatet. Rett det som trengs, og kryss bort det som ikke skal lagres.'
    : (notat?.tekst ? 'Fant ingen linjer som starter med «Vedtak:» eller «Aksjon:».' : 'Notatet er tomt.');
  d.kropp.replaceChildren(h('p', { class: 'sgr-ingress', text: mote.tittel + ', ' + datoTekst(mote.dato) }), h('p', { class: 'sgr-hjelp', text: ingress }), funn.length ? liste : null);

  const avbrytK = knapp('Avbryt', () => d.forsok());
  const lagreK = knapp(mote.avholdt ? 'Lagre' : 'Lagre og avslutt', null, 'btn small primary');
  f.knapper.append(h('span', { class: 'sgr-flex' }), avbrytK, lagreK);
  const start = () => JSON.stringify(rader.map((r) => [r.boks.checked, r.skjema.alle()]));
  const ren = start();
  d.foerLukk = async () => start() === ren || bekreft(d, d.fot, 'Ingenting er lagret ennå.', 'Lukk uten å lagre', 'Fortsett');

  lagreK.addEventListener('click', kjor(async () => {
    const valgt = rader.filter((r) => r.boks.checked);
    for (const r of valgt) if (!r.skjema.valider()) { f.sett('Rett feltet som er merket.', true); return; }
    lagreK.disabled = true; f.sett('Lagrer …');
    let nV = 0, nA = 0;
    try {
      for (const r of valgt) {
        const v = r.skjema.verdier();
        if (r.x.type === 'vedtak') {
          const felles = { status: 'besluttet', vedtak: v.vedtak, vedtatt: mote.dato || idag(), notat_ref: r.x.ref, publisert: true };
          if (v.sak === 'ny') await api.lagre('sg_saker', { tittel: v.tittel, mote_id: mote.id, ...felles });
          else {
            const sak = saker.find((s) => s.id === v.sak);
            Object.assign(sak, await api.lagre('sg_saker', { id: sak.id, endret: sak.endret, ...felles }));
          }
          nV++;
        } else {
          await api.lagre('sg_aksjoner', { hva: v.hva, hvem: v.hvem, frist: v.frist, mote_id: mote.id, notat_ref: r.x.ref, publisert: true });
          nA++;
        }
        r.boks.checked = false; r.boks.disabled = true;
      }
      if (!mote.avholdt) mote = await api.lagre('sg_moter', { id: mote.id, endret: mote.endret, avholdt: true });
    } catch (e) {
      lagreK.disabled = false;
      f.sett((e.message || 'Kunne ikke lagre.') + (nV + nA ? ' ' + (nV + nA) + ' er lagret. Lukk og åpne igjen for å fortsette.' : ''), true);
      return;
    }
    ferdigVisning(nV, nA);
  }));

  function ferdigVisning(nV, nA) {
    d.foerLukk = null;
    d.tittelEl.textContent = 'Møtet er avsluttet';
    const deler = [];
    if (nV) deler.push(nV + ' vedtak');
    if (nA) deler.push(nA + (nA === 1 ? ' aksjon' : ' aksjoner'));
    d.kropp.replaceChildren(h('p', { class: 'sgr-ingress', text: deler.length ? 'Lagret og publisert: ' + deler.join(' og ') + '.' : 'Ingen nye vedtak eller aksjoner er lagret.' }),
      h('p', { class: 'sgr-hjelp', text: mote.referat_publisert ? 'Referatet er publisert.' : 'Referatet er ikke publisert ennå. Styringsgruppen ser notatet når du publiserer det.' }));
    f.sett('');
    const lukkK = knapp('Lukk', () => d.lukk(), 'btn small' + (mote.referat_publisert ? ' primary' : ''));
    const pubK = mote.referat_publisert ? null : knapp('Publiser referat', kjor(async () => {
      pubK.disabled = true;
      try {
        mote = await api.lagre('sg_moter', { id: mote.id, endret: mote.endret, referat_publisert: true });
        d.kropp.lastElementChild.textContent = 'Referatet er publisert.';
        pubK.remove();
        lukkK.classList.add('primary');
        lukkK.focus();
        melding('Referatet er publisert.');
      } catch (e) { pubK.disabled = false; f.sett(e.message, true); }
    }), 'btn small primary');
    f.knapper.replaceChildren(h('span', { class: 'sgr-flex' }), lukkK, pubK);
    d.resultat = mote;
    (pubK || lukkK).focus();
  }

  (rader[0]?.skjema.felter[0].inp || lagreK).focus();
  return d.ferdig;
}

// ---------- historikk ----------
const TABELL_ENT = { sg_moter: 'møtet', sg_status: 'statuslinjen', sg_saker: 'saken', sg_aksjoner: 'aksjonen', sg_risikoer: 'risikoen', sg_milepaeler: 'milepælen', sg_seksjoner: 'seksjonen', sg_innstillinger: 'datoene for forprosjektet' };
const HANDLING = { insert: 'opprettet', update: 'endret', delete: 'slettet' };
const FELT_NAVN = {
  tittel: 'Tittel', dato: 'Dato', sted: 'Sted', samlet_status: 'Samlet status', samlet_kommentar: 'Kommentar til samlet status', agenda: 'Agenda',
  avholdt: 'Avholdt', referat_publisert: 'Referat publisert', publisert: 'Publisert', navn: 'Område', farge: 'Farge', kommentar: 'Kommentar',
  rekkefolge: 'Rekkefølge', bakgrunn: 'Bakgrunn', anbefaling: 'Anbefaling', mote_id: 'Møte', status: 'Status', vedtak: 'Vedtak', vedtatt: 'Vedtaksdato',
  hva: 'Hva', hvem: 'Hvem', frist: 'Frist', ferdig: 'Ferdig', risiko: 'Risiko', niva: 'Nivå', tiltak: 'Tiltak', eier: 'Eier', aktiv: 'Aktiv',
  til: 'Til', tekst: 'Tekst', viktig: 'Viktig', eyebrow: 'Liten overskrift', html: 'Tekst', start: 'Start', slutt: 'Slutt', nokkel: 'Nøkkel', notat_ref: 'Notatlinje',
};
const SKJULT = new Set(['id', 'endret', 'endret_av', 'doc']);
const DATOFELT = new Set(['dato', 'til', 'frist', 'vedtatt', 'start', 'slutt']);
const UTEN_VERDI = new Set(['html', 'agenda', 'mote_id', 'notat_ref', 'rekkefolge']);

function verdiTekst(k, v) {
  if (v == null || v === '') return 'tom';
  if (typeof v === 'boolean') return v ? 'ja' : 'nei';
  if (k === 'farge' || k === 'samlet_status') return FARGE_NAVN[v] || v;
  if (k === 'niva') return NIVA_NAVN[v] || v;
  if (k === 'status') return STATUS_NAVN[v] || v;
  if (DATOFELT.has(k)) return datoTekst(v);
  return '«' + kortTittel(typeof v === 'string' ? v : JSON.stringify(v), 60) + '»';
}

function radNavn(tabell, r) {
  if (!r) return '';
  if (tabell === 'sg_moter') return [r.tittel, datoTekst(r.dato)].filter(Boolean).join(' ');
  return r.tittel || r.hva || r.risiko || r.tekst || r.navn || r.nokkel || '';
}

export function relativTid(ts, naa = Date.now()) {
  const t = new Date(ts);
  const s = Math.round((naa - t.getTime()) / 1000);
  const kl = 'kl. ' + pad(t.getHours()) + '.' + pad(t.getMinutes());
  if (s < 60) return 'nå nettopp';
  if (s < 3600) { const m = Math.floor(s / 60); return 'for ' + m + (m === 1 ? ' minutt' : ' minutter') + ' siden'; }
  const iDag = new Date(naa); iDag.setHours(0, 0, 0, 0);
  if (t >= iDag) { const ti = Math.floor(s / 3600); return 'for ' + ti + (ti === 1 ? ' time' : ' timer') + ' siden'; }
  const iGaar = new Date(iDag); iGaar.setDate(iGaar.getDate() - 1);
  if (t >= iGaar) return 'i går ' + kl;
  return datoTekst(isoDato(t)) + ' ' + kl;
}

/** Én linje i historikken som lesbar tekst. */
export function beskrivEndring(e, naa = Date.now()) {
  const hvem = e.endret_av ? api.navnFra(e.endret_av) : 'Noen';
  const r = e.ny || e.gammel;
  const navn = radNavn(e.tabell, r);
  const ent = TABELL_ENT[e.tabell] || 'raden';
  const felter = [];
  if (e.handling === 'update' && e.gammel && e.ny) {
    for (const k of Object.keys({ ...e.gammel, ...e.ny })) {
      if (SKJULT.has(k)) continue;
      const a = e.gammel[k], b = e.ny[k];
      if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;
      const etikett = FELT_NAVN[k] || k;
      felter.push(UTEN_VERDI.has(k) ? etikett + ' er endret' : etikett + ': ' + verdiTekst(k, a) + ' → ' + verdiTekst(k, b));
    }
  }
  return { tekst: hvem + ' ' + (HANDLING[e.handling] || 'endret') + ' ' + ent + (navn ? ' «' + kortTittel(navn, 60) + '»' : '') + ' ' + relativTid(e.tidspunkt, naa), felter };
}

export async function visHistorikk() {
  const d = dialog({ tittel: 'Historikk', stor: true });
  const f = fotMedStatus(d);
  f.knapper.append(h('span', { class: 'sgr-flex' }), knapp('Lukk', () => d.lukk()));
  const liste = h('ol', { class: 'sgr-historikk' });
  async function last() {
    d.kropp.replaceChildren(h('p', { class: 'sgr-laster', text: 'Laster …' }));
    const rader = await api.rpc('sg_endringer', { grense: 30 }) || [];
    liste.replaceChildren(...rader.map((e) => {
      const b = beskrivEndring(e);
      const handlinger = h('div', { class: 'sgr-hist-knapper' });
      const angre = knapp('Angre', async () => {
        if (!(await bekreft(d, handlinger, 'Angre denne endringen?', 'Angre', 'Avbryt', false))) { angre.focus(); return; }
        try {
          await api.rpc('sg_angre', { endring: e.id });
          api.varsleEndring();
          melding('Endringen er angret.');
          await last();
        } catch (x) { f.sett(x.message, true); }
      }, 'btn small', { 'aria-label': 'Angre: ' + b.tekst });
      handlinger.append(angre);
      return h('li', {}, h('div', { class: 'sgr-hist-tekst' }, h('p', { text: b.tekst }), b.felter.length ? h('ul', {}, b.felter.map((t) => h('li', { text: t }))) : null), handlinger);
    }));
    d.kropp.replaceChildren(rader.length ? liste : h('p', { class: 'sgr-hjelp', text: 'Ingen endringer ennå.' }));
  }
  try { await last(); } catch (e) { d.kropp.replaceChildren(h('p', { class: 'sgr-feil', text: e.message })); }
  (liste.querySelector('button') || d.fot.querySelector('button')).focus();
  return d.ferdig;
}

// ---------- hjelp ----------
const HJELP = [
  'Velg «Forbered møtet» under Neste møte. Veiviseren tar deg gjennom status, saker og agenda, og alt lagres underveis.',
  'Statuslinjene hentes fra forrige møte. Endre bare det som er nytt.',
  'Alt er utkast til du velger «Publiser møtet». Bruk «Se som styringsgruppen» for å se siden slik de ser den.',
  'Under møtet skriver du «Vedtak:» eller «Aksjon:» først på linjen i notatet. @Navn og «innen 15.11» blir forslag til hvem og frist.',
  'Etter møtet åpner du møtet med ✎ og velger «Avslutt møtet». Du velger hvilke vedtak og aksjoner som skal lagres.',
  'Velg «Publiser referat» når notatet er klart. Har noe blitt feil, kan du angre det under «Historikk».',
];
export function visHjelp() {
  const d = dialog({ tittel: 'Slik bruker du siden' });
  d.kropp.append(h('ol', { class: 'sgr-hjelpeliste' }, HJELP.map((t) => h('li', { text: t }))));
  const ok = knapp('Lukk', () => d.lukk(), 'btn small primary');
  d.fot.append(h('div', { class: 'sgr-knapper' }, h('span', { class: 'sgr-flex' }), ok));
  ok.focus();
  return d.ferdig;
}

// ---------- montering i visningen ----------
export function seSomLeser() {
  try { return sessionStorage.getItem(LESER_NOKKEL) === '1'; } catch { return false; }
}

function lagLinje(rot) {
  const paa = seSomLeser();
  const bryter = h('button', { type: 'button', role: 'switch', class: 'sgr-bryter', 'aria-checked': String(paa) },
    h('span', { class: 'sgr-spor', 'aria-hidden': 'true' }), h('span', { text: 'Se som styringsgruppen' }));
  bryter.addEventListener('click', () => {
    const ny = bryter.getAttribute('aria-checked') !== 'true';
    bryter.setAttribute('aria-checked', String(ny));
    try { sessionStorage.setItem(LESER_NOKKEL, ny ? '1' : '0'); } catch {}
    rot.classList.toggle('sgr-leser', ny);
    window.dispatchEvent(new CustomEvent('sg:seSomLeser', { detail: ny }));
  });
  return h('div', { class: 'sgr-linje', role: 'region', 'aria-label': 'Redigering' },
    h('span', { class: 'sgr-linje-merke', text: 'Redaktør' }), bryter, h('span', { class: 'sgr-flex' }),
    knapp('Historikk', kjor(() => visHistorikk())), knapp('Hjelp', kjor(() => visHjelp())));
}

async function nesteMoteId(sek) {
  const el = sek.querySelector('[data-tabell="sg_moter"][data-id]');
  if (el) return el.dataset.id;
  const m = await api.hent('sg_moter', 'select=id&avholdt=eq.false&order=dato.asc&limit=1');
  return m[0]?.id ?? null;
}

function seksjonsKnapper(sek, nokkel) {
  const fast = sek.dataset.tabell === 'sg_seksjoner' || (sek.id || '').startsWith('seksjon-');
  const type = fast ? null : SEKSJONER[nokkel];
  const nye = (tabell) => kjor(() => aapneSkjema(tabell, null));
  const k = [];
  if (type === 'mote') k.push(['Forbered møtet', kjor(async () => forberedMote(await nesteMoteId(sek)))], ['Nytt møte', kjor(() => forberedMote(null))]);
  else if (type === 'saker') k.push(['Ny sak', nye('sg_saker')]);
  else if (type === 'aksjoner') k.push(['Ny aksjon', nye('sg_aksjoner')]);
  else if (type === 'tidslinje') k.push(['Ny milepæl', nye('sg_milepaeler')], ['Datoer for forprosjektet', kjor(async () => aapneSkjema('sg_innstillinger', (await api.hent('sg_innstillinger', 'id=eq.1'))[0] || null))]);
  else if (type === 'risiko') k.push(['Ny risiko', nye('sg_risikoer')]);
  if (!type) {
    k.push(['Rediger tekst', kjor(async () => {
      const rad = sek.dataset.tabell === 'sg_seksjoner' && sek.dataset.id ? await hentRad('sg_seksjoner', sek.dataset.id) : (await api.hent('sg_seksjoner', 'nokkel=eq.' + enc(nokkel)))[0];
      return aapneSkjema('sg_seksjoner', rad || null, { forhand: { nokkel } });
    })]);
  }
  return k;
}

/** Legger ✎, seksjonsknapper og redaktørlinjen inn i visningen. Kan kalles etter hver tegning. */
export function monterRedigering(rot) {
  if (!rot) return;
  stil();
  rot.classList.add('sgr-aktiv');
  rot.classList.toggle('sgr-leser', seSomLeser());

  if (!rot.querySelector(':scope > .sgr-linje')) rot.prepend(lagLinje(rot));
  else rot.querySelector(':scope > .sgr-linje .sgr-bryter')?.setAttribute('aria-checked', String(seSomLeser()));

  for (const el of rot.querySelectorAll('[data-tabell][data-id]')) {
    const tabell = el.dataset.tabell;
    if (!TABELLER[tabell]) continue;
    if (tabell === 'sg_seksjoner' && el.hasAttribute('data-seksjon')) continue; // «Rediger tekst» dekker dette
    const vertEl = el.tagName === 'TR' ? el.lastElementChild : el;
    if (!vertEl || vertEl.querySelector(':scope > .sgr-penn')) continue;
    const ent = TABELL_ENT[tabell] || 'raden';
    const navn = el.dataset.navn || '';
    const penn = h('button', { type: 'button', class: 'sgr-penn', 'aria-label': 'Rediger ' + ent + (navn ? ' ' + navn : ''), title: 'Rediger', text: '✎' });
    penn.addEventListener('click', kjor(async () => {
      const rad = await hentRad(tabell, el.dataset.id);
      if (!rad) { melding('Fant ikke dette. Det kan være slettet.', true); return; }
      return aapneSkjema(tabell, rad);
    }));
    vertEl.classList.add('sgr-redigerbar');
    vertEl.append(penn);
  }

  for (const sek of rot.querySelectorAll('[data-seksjon]')) {
    const vk = sek.querySelector('.sg-verktoy');
    if (!vk) continue;
    vk.querySelectorAll(':scope > .sgr-vk').forEach((b) => b.remove());
    for (const [tekst, fn] of seksjonsKnapper(sek, sek.dataset.seksjon)) vk.append(knapp(tekst, fn, 'btn small sgr-vk'));
  }
}
