// Presentasjonsmodus for et styringsgruppemøte: fast scene på 1920×1080 som skaleres til vinduet.
// Utkast vises aldri her, heller ikke for redaktører.
import * as api from './api.js';
import {
  el, hentAlt, iDag, datoTekst, agendaTekst, punkter, tidslinje, framdriftslinje, tallBlokk,
  statusMoter, FARGER, NIVAER, sorterRisiko,
} from './visning.js';

const B = 1920, H = 1080;
const pub = (r) => r && r.publisert !== false;
const stor = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/* ---------- lysbilder ---------- */
function lysbilde(type, eyebrow, tittel, ...innhold) {
  return el('div', { class: 'p-slide p-' + type, 'data-type': type },
    el('div', { class: 'p-ramme' },
      eyebrow || tittel ? el('header', { class: 'p-hode' }, eyebrow ? el('p', { class: 'p-eyebrow', tekst: eyebrow }) : null, tittel ? el('h1', { tekst: tittel }) : null) : null,
      el('div', { class: 'p-innhold' }, innhold)));
}
const prikk = (f) => el('span', { class: 'p-prikk', style: `background:${f.css}` });
const tomt = (t) => el('p', { class: 'p-tom', tekst: t });

function aksjonListe(aksjoner, idag) {
  return el('ul', { class: 'p-aksjoner' }, aksjoner.map((a) => {
    const forfalt = !a.ferdig && a.frist && a.frist < idag;
    return el('li', { class: forfalt ? 'forfalt' : '' },
      el('p', {}, forfalt ? el('span', { class: 'p-merke forfalt', tekst: 'Forfalt' }) : null, el('span', { tekst: a.hva })),
      el('p', { class: 'p-meta', tekst: [a.hvem, a.frist ? 'frist ' + datoTekst(a.frist) : null].filter(Boolean).join(' · ') }));
  }));
}

/** Lager lysbildene for møtet. Gir [{ node, sakId? }]. */
function lagLysbilder(d, mote, idag) {
  const saker = d.saker.filter(pub);
  const ut = [];
  // 1. tittel
  ut.push({ node: el('div', { class: 'p-slide p-tittel', 'data-type': 'tittel' }, el('div', { class: 'p-ramme' },
    el('img', { class: 'p-logo', src: new URL('../assets/nordlys-wordmark-mint.svg', import.meta.url).href, alt: 'Nordlys' }),
    el('div', { class: 'p-innhold' },
      el('h1', { tekst: mote.tittel || 'Styringsgruppemøte' }),
      el('p', { class: 'p-dato', tekst: stor(datoTekst(mote.dato, { ukedag: true })) }),
      mote.sted ? el('p', { class: 'p-sted', tekst: mote.sted }) : null))) });

  const punktLysbilder = [];
  const agendaNavn = [];
  for (const p of mote.agenda || []) {
    const navn = agendaTekst(p, saker);
    if (!navn) continue;
    if (p.type === 'status') {
      const egne = d.status.filter((s) => s.mote_id === mote.id).sort((a, b) => (a.rekkefolge || 0) - (b.rekkefolge || 0));
      let kilde = mote, rader = egne;
      if (!egne.length && (!mote.samlet_status || mote.samlet_status === 'ikke_satt')) {
        const tidl = d.moter.filter((m) => m.dato <= mote.dato && m.id !== mote.id);
        const { siste } = statusMoter(tidl, d.status);
        if (siste) { kilde = siste; rader = d.status.filter((s) => s.mote_id === siste.id).sort((a, b) => (a.rekkefolge || 0) - (b.rekkefolge || 0)); }
      }
      const f = FARGER[kilde.samlet_status] || FARGER.ikke_satt;
      punktLysbilder.push({ node: lysbilde('status', kilde === mote ? 'Status' : 'Status fra ' + datoTekst(kilde.dato), 'Status',
        el('div', { class: 'p-samlet' }, prikk(f), el('strong', { tekst: 'Samlet: ' + f.navn }), kilde.samlet_kommentar ? el('span', { tekst: kilde.samlet_kommentar }) : null),
        rader.length ? el('table', { class: 'p-tabell' },
          el('thead', {}, el('tr', {}, el('th', { tekst: 'Område' }), el('th', { tekst: 'Status' }), el('th', { tekst: 'Kommentar' }))),
          el('tbody', {}, rader.map((r) => { const rf = FARGER[r.farge] || FARGER.ikke_satt;
            return el('tr', {}, el('td', { tekst: r.navn }), el('td', { class: 'p-farge' }, prikk(rf), rf.navn), el('td', { tekst: r.kommentar || '' })); }))) : null) });
    } else if (p.type === 'sak') {
      const s = saker.find((x) => x.id === p.sak_id);
      if (!s) continue;
      const bg = punkter(s.bakgrunn);
      punktLysbilder.push({ sakId: s.id, node: lysbilde('sak', s.status === 'besluttet' ? 'Sak · besluttet' : 'Sak til avklaring', s.tittel,
        bg.length ? el('ul', { class: 'p-punkter' }, bg.map((t) => el('li', { tekst: t }))) : null,
        s.anbefaling ? el('div', { class: 'p-anbefaling' }, el('p', { class: 'p-eyebrow', tekst: 'Anbefaling' }), el('p', { tekst: s.anbefaling })) : null,
        s.status === 'besluttet' && s.vedtak ? el('div', { class: 'p-anbefaling vedtak' }, el('p', { class: 'p-eyebrow', tekst: 'Vedtak' }), el('p', { tekst: s.vedtak })) : null) });
    } else if (p.type === 'risiko') {
      const r = d.risikoer.filter(pub).filter((x) => x.aktiv !== false && (x.niva === 'hoy' || x.niva === 'middels')).sort(sorterRisiko);
      punktLysbilder.push({ node: lysbilde('risiko', 'Høy og middels', 'Risiko',
        r.length ? el('ul', { class: 'p-risikoer' }, r.map((x) => { const n = NIVAER[x.niva];
          return el('li', {}, el('span', { class: 'p-niva', style: `--c:${n.css}`, tekst: n.navn }),
            el('div', {}, el('strong', { tekst: x.risiko }),
              x.tiltak ? el('p', { tekst: 'Tiltak: ' + x.tiltak }) : null,
              x.eier ? el('p', { class: 'p-meta', tekst: 'Eier: ' + x.eier }) : null)); })) : tomt('Ingen høye eller middels risikoer.')) });
    } else if (p.type === 'aksjoner') {
      const a = d.aksjoner.filter(pub).filter((x) => !x.ferdig);
      punktLysbilder.push({ node: lysbilde('aksjoner', 'Åpne', 'Aksjonspunkter', a.length ? aksjonListe(a, idag) : tomt('Ingen åpne aksjonspunkter.')) });
    } else if (p.type === 'tidslinje') {
      const b = tidslinje(d.milepaeler.filter(pub), d.innstillinger, idag);
      const kommende = b.liste.filter((r) => r.status !== 'ferdig').slice(0, 4);
      punktLysbilder.push({ node: lysbilde('tidslinje', 'Framdrift', 'Tidslinje',
        tallBlokk(b), framdriftslinje(b.framdrift),
        kommende.length ? el('ol', { class: 'p-milepaeler' }, kommende.map((r) => el('li', { class: (r.neste ? 'neste' : '') + (r.viktig ? ' viktig' : '') },
          el('strong', { tekst: r.datoTekst }), el('span', { tekst: r.tekst }), el('em', { tekst: r.status === 'pagar' ? r.statusTekst : stor(r.relativ || '') })))) : null) });
    } else if (p.type === 'fritt') {
      punktLysbilder.push({ node: lysbilde('fritt', null, null, el('p', { class: 'p-fritt', tekst: navn })) });
    }
    agendaNavn.push(navn);
  }
  // 2. agenda
  ut.push({ node: lysbilde('agenda', datoTekst(mote.dato), 'Agenda', el('ol', { class: 'p-agenda' }, agendaNavn.map((t) => el('li', { tekst: t })))) });
  ut.push(...punktLysbilder);
  // 4. oppsummering
  ut.push({ node: oppsummering(d, mote, idag), oppsummering: true });
  return ut;
}

function oppsummering(d, mote, idag) {
  const vedtak = d.saker.filter(pub).filter((s) => s.mote_id === mote.id && s.status === 'besluttet');
  const aksjoner = d.aksjoner.filter(pub).filter((a) => a.mote_id === mote.id);
  return lysbilde('oppsummering', 'Fra møtet', 'Oppsummering',
    !vedtak.length && !aksjoner.length ? tomt('Ingen vedtak eller aksjoner er registrert ennå.') : null,
    vedtak.length ? el('div', { class: 'p-blokk' }, el('p', { class: 'p-eyebrow', tekst: 'Vedtak' }),
      el('ul', { class: 'p-vedtak' }, vedtak.map((s) => el('li', {}, el('strong', { tekst: s.tittel }), s.vedtak ? el('p', { tekst: s.vedtak }) : null)))) : null,
    aksjoner.length ? el('div', { class: 'p-blokk' }, el('p', { class: 'p-eyebrow', tekst: 'Aksjoner' }), aksjonListe(aksjoner, idag)) : null);
}

/* ---------- tilpasning av tekst ---------- */
/** Krymper teksten på et lysbilde (CSS-variabelen --k) til innholdet passer. Måler uskalert layout. */
export function fit(slide) {
  const inn = slide.querySelector('.p-innhold');
  const ramme = slide.querySelector('.p-ramme');
  if (!inn) return 1;
  const passer = () => inn.scrollHeight <= inn.clientHeight + 1 && inn.scrollWidth <= inn.clientWidth + 1 && ramme.scrollHeight <= ramme.clientHeight + 1;
  slide.style.setProperty('--k', '1');
  if (passer()) return 1;
  let lo = 0.3, hi = 1;
  for (let i = 0; i < 10; i++) {
    const m = (lo + hi) / 2;
    slide.style.setProperty('--k', m.toFixed(3));
    if (passer()) lo = m; else hi = m;
  }
  slide.style.setProperty('--k', lo.toFixed(3));
  return lo;
}
async function klar(rot) {
  try { await document.fonts.ready; } catch {}
  await Promise.all([...rot.querySelectorAll('img')].map((i) => (i.complete ? null : new Promise((ok) => { i.onload = i.onerror = ok; }))));
}

async function hentMote(moteId) {
  const d = await hentAlt();
  const mote = d.moter.find((m) => m.id === moteId);
  if (!mote) throw new Error('Fant ikke møtet.');
  return { d, mote };
}

/* ---------- presentasjon ---------- */
let aktiv = null;

/** Starter presentasjonen av møtet i rot. Gir en funksjon som avslutter. */
export async function startPresentasjon(rot, moteId) {
  if (aktiv) aktiv();
  const idag = iDag();
  const scene = el('div', { class: 'p-scene', role: 'region', 'aria-roledescription': 'presentasjon', 'aria-label': 'Presentasjon' });
  const vert = el('div', { class: 'p-rot', tabindex: '-1' }, scene);
  rot.replaceChildren(vert);
  document.documentElement.classList.add('p-aktiv');

  let { d, mote } = await hentMote(moteId);
  const redaktor = await api.erRedaktor();
  let bilder = [], i = 0;
  const nr = el('span', { class: 'p-nr' });
  const fyll = el('div', { class: 'p-stripe-fyll' });
  const fot = el('div', { class: 'p-fot' }, nr, el('div', { class: 'p-stripe' }, fyll));
  const telling = el('div', { class: 'p-telling', hidden: true, 'aria-live': 'polite' });
  const bVedtak = el('button', { type: 'button', class: 'p-knapp', tekst: 'Registrer vedtak', hidden: true });
  const bAksjon = el('button', { type: 'button', class: 'p-knapp', tekst: 'Ny aksjon' });
  const knapper = el('div', { class: 'p-knapper' }, bVedtak, bAksjon);
  const beskjed = el('div', { class: 'p-beskjed', role: 'status' });
  if (redaktor) { telling.hidden = false; vert.append(knapper); }
  vert.append(beskjed);

  async function bygg(behold = 0) {
    for (const b of bilder) b.node.remove();
    bilder = lagLysbilder(d, mote, idag);
    scene.prepend(...bilder.map((b) => b.node));
    scene.append(fot, telling);
    await klar(scene);
    bilder.forEach((b) => fit(b.node));
    vis(Math.min(behold, bilder.length - 1));
  }
  function vis(n) {
    i = Math.max(0, Math.min(bilder.length - 1, n));
    bilder.forEach((b, j) => { b.node.classList.toggle('aktiv', j === i); b.node.setAttribute('aria-hidden', j === i ? 'false' : 'true'); });
    nr.textContent = `${i + 1} / ${bilder.length}`;
    fyll.style.width = ((i + 1) / bilder.length) * 100 + '%';
    bVedtak.hidden = !bilder[i].sakId;
  }
  function skaler() {
    const w = vert.clientWidth || innerWidth, h = vert.clientHeight || innerHeight;
    const s = Math.min(w / B, h / H);
    scene.style.transform = `translate(${(w - B * s) / 2}px, ${(h - H * s) / 2}px) scale(${s})`;
  }

  const fram = () => vis(i + 1), bak = () => vis(i - 1);
  const iFelt = (t) => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.closest?.('dialog[open], [role=dialog]'));
  function tast(e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || iFelt(e.target)) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === ' ' || k === 'PageDown' || k === 'Spacebar') fram();
    else if (k === 'ArrowLeft' || k === 'PageUp') bak();
    else if (k === 'Home') vis(0);
    else if (k === 'End') vis(bilder.length - 1);
    else if (k === 'f' || k === 'F') {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      else document.documentElement.requestFullscreen?.().catch(() => {});
    } else if (k === 'Escape' || k === 'Esc') location.hash = '';
    else if (k === 'n' || k === 'N') window.open('#notat/' + moteId, '_blank', 'noopener');
    else return;
    e.preventDefault();
  }
  function klikk(e) {
    if (e.target.closest('button, a, input, .p-knapper')) return;
    const r = vert.getBoundingClientRect();
    if (e.clientX - r.left > r.width / 2) fram(); else bak();
  }
  let sveip = null;
  const tStart = (e) => { const t = e.changedTouches[0]; sveip = { x: t.clientX, y: t.clientY }; };
  const tSlutt = (e) => {
    if (!sveip) return;
    const t = e.changedTouches[0], dx = t.clientX - sveip.x, dy = t.clientY - sveip.y;
    sveip = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { e.preventDefault(); if (dx < 0) fram(); else bak(); }
  };
  let skjulTid = 0;
  function mus() {
    vert.classList.add('p-mus');
    clearTimeout(skjulTid);
    skjulTid = setTimeout(() => vert.classList.remove('p-mus'), 2500);
  }
  function melding(t) { beskjed.textContent = t; beskjed.classList.add('vis'); setTimeout(() => beskjed.classList.remove('vis'), 4000); }
  const redigering = (f) => import('./redigering.js').then(f).catch(() => melding('Redigering er ikke tilgjengelig.'));
  bVedtak.addEventListener('click', () => { const s = bilder[i].sakId; if (s) redigering((m) => m.registrerVedtak(s)); });
  bAksjon.addEventListener('click', () => redigering((m) => m.nyAksjon(moteId)));

  // merket for redaktører: vedtak og aksjoner registrert for møtet, hentet hvert 15. sekund
  let forrigeTelling = '';
  async function tell() {
    try {
      const [v, a] = await Promise.all([
        api.hent('sg_saker', 'select=id&status=eq.besluttet&mote_id=eq.' + encodeURIComponent(moteId)),
        api.hent('sg_aksjoner', 'select=id&mote_id=eq.' + encodeURIComponent(moteId)),
      ]);
      const t = `${v.length} vedtak · ${a.length} ${a.length === 1 ? 'aksjon' : 'aksjoner'}`;
      telling.textContent = t;
      if (forrigeTelling && t !== forrigeTelling) await oppdater();
      forrigeTelling = t;
    } catch {}
  }
  async function oppdater() {
    try { ({ d, mote } = await hentMote(moteId)); await bygg(i); } catch {}
  }
  const endret = () => { oppdater(); if (redaktor) tell(); };

  await bygg(0);
  skaler();
  const ro = new ResizeObserver(skaler); ro.observe(vert);
  addEventListener('resize', skaler);
  document.addEventListener('fullscreenchange', skaler);
  document.addEventListener('keydown', tast);
  vert.addEventListener('click', klikk);
  vert.addEventListener('touchstart', tStart, { passive: true });
  vert.addEventListener('touchend', tSlutt);
  vert.addEventListener('mousemove', mus);
  addEventListener('sg:endret', endret);
  let tid = 0;
  if (redaktor) { tell(); tid = setInterval(tell, 15000); }
  vert.focus({ preventScroll: true });

  function stopp() {
    if (aktiv !== stopp) return;
    aktiv = null;
    clearInterval(tid); clearTimeout(skjulTid); ro.disconnect();
    removeEventListener('resize', skaler);
    removeEventListener('hashchange', vedHash);
    removeEventListener('sg:endret', endret);
    document.removeEventListener('fullscreenchange', skaler);
    document.removeEventListener('keydown', tast);
    document.documentElement.classList.remove('p-aktiv');
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    vert.remove();
  }
  const vedHash = () => { if (location.hash !== '#presenter/' + moteId) stopp(); };
  addEventListener('hashchange', vedHash);
  aktiv = stopp;
  return stopp;
}

/* ---------- utskrift ---------- */
/** Tegner alle lysbildene under hverandre (ett per side) og åpner utskrift. */
export async function skrivUt(rot, moteId) {
  if (aktiv) aktiv();
  const { d, mote } = await hentMote(moteId);
  const bilder = lagLysbilder(d, mote, iDag());
  const ark = bilder.map((b, j) => el('div', { class: 'p-ark' }, el('div', { class: 'p-scene p-ark-scene' }, b.node,
    el('div', { class: 'p-fot' }, el('span', { class: 'p-nr', tekst: `${j + 1} / ${bilder.length}` })))));
  const stabel = el('div', { class: 'p-utskrift' }, ark);
  bilder.forEach((b) => b.node.classList.add('aktiv'));
  rot.replaceChildren(stabel);
  document.documentElement.classList.add('p-skriver');
  // skjul alt annet på siden ved utskrift
  for (let n = rot; n && n !== document.body; n = n.parentElement) {
    n.classList.add('p-sti');
    for (const s of n.parentElement?.children || []) if (s !== n) s.classList.add('p-skjul');
  }
  let side = document.getElementById('p-side');
  if (!side) { side = el('style', { id: 'p-side' }); document.head.append(side); }
  side.textContent = '@page { size: 1920px 1080px; margin: 0 }';
  const skaler = () => { const w = stabel.clientWidth; for (const a of ark) a.firstChild.style.transform = `scale(${w / B})`; };
  await klar(stabel);
  bilder.forEach((b) => fit(b.node));
  skaler();
  addEventListener('resize', skaler);
  const rydd = () => {
    removeEventListener('resize', skaler); removeEventListener('hashchange', rydd);
    document.documentElement.classList.remove('p-skriver');
    document.querySelectorAll('.p-sti, .p-skjul').forEach((n) => n.classList.remove('p-sti', 'p-skjul'));
    side.remove();
  };
  addEventListener('hashchange', rydd);
  await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
  window.print();
  return rydd;
}
