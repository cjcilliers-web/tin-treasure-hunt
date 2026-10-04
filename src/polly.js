// Phase 3 — Polly, the natural-language guide for Treasure Hunt discovery.
//
// How it works:
//   1. Understand the question and turn it into a small "intent" object.
//      Built-in rules always run. If the Workers AI binding exists, the model
//      refines the intent for free-form questions (it never invents treasures).
//   2. Answer from real data: live drops, distance, opening hours, ratings,
//      the explorer's credits, open codes and what they already found.
//   3. Speak the explorer's language: English, Spanish, Portuguese, French
//      or German (cruise passengers).
//   4. Polly's tip (/api/polly/tip) is a proactive nudge on the Hunt screen,
//      e.g. an open code about to expire, lunchtime treasures nearby or the
//      Sunday raffle.
import { body, json, str, distanceM, walkMin, nextRaffleAt, lastRaffleAt, iso, getSettings } from './lib.js';
import { liveDrops } from './hunt.js';

export const LANGS = ['en', 'es', 'pt', 'fr', 'de'];

const CAT_WORDS = {
  Food: ['food', 'eat', 'hungry', 'taco', 'burger', 'lunch', 'dinner', 'breakfast', 'comida', 'comer', 'hambre', 'almuerzo', 'cena', 'fome', 'almoço', 'jantar', 'manger', 'faim', 'déjeuner', 'dîner', 'essen', 'hunger', 'mittagessen', 'abendessen'],
  Drink: ['drink', 'coffee', 'café', 'cafe', 'beer', 'cocktail', 'thirsty', 'bebida', 'cerveza', 'tomar', 'cerveja', 'boisson', 'bière', 'getränk', 'kaffee', 'bier', 'trinken'],
  Dessert: ['dessert', 'sweet', 'ice cream', 'chocolate', 'helado', 'postre', 'dulce', 'sorvete', 'sobremesa', 'glace', 'chocolat', 'eis', 'nachtisch', 'schokolade'],
  Adventure: ['adventure', 'snorkel', 'dive', 'kayak', 'beach', 'scooter', 'tour', 'aventura', 'playa', 'bucear', 'praia', 'mergulho', 'aventure', 'plage', 'plongée', 'abenteuer', 'strand', 'tauchen'],
  Shopping: ['shop', 'shopping', 'souvenir', 'gift', 'jewel', 'compras', 'regalo', 'tienda', 'presente', 'loja', 'boutique', 'cadeau', 'bijou', 'einkaufen', 'geschenk', 'schmuck'],
  Mystery: ['mystery', 'surprise', 'secret', 'misterio', 'sorpresa', 'mistério', 'surpresa', 'mystère', 'überraschung', 'geheimnis'],
};

const LANG_HINTS = {
  es: /[¿¡ñ]|\b(quiero|tengo|dónde|donde|niños|hola|tesoros?|cerca|créditos|creditos|cuántos|comida|hora)\b/,
  pt: /\b(olá|ola|quero|tenho|crianças|perto|tesouros?|quantos|créditos|obrigad[oa]|você|onde)\b|ção\b/,
  fr: /\b(bonjour|je|veux|enfants|près|trésors?|combien|où|merci|salut|une heure)\b/,
  de: /\b(hallo|ich|möchte|kinder|nähe|schätze?|schatz|wie viele|guten|stunde|danke)\b/,
};

export function detectLang(q) {
  const t = ` ${q.toLowerCase()} `;
  for (const l of ['pt', 'fr', 'de', 'es']) if (LANG_HINTS[l].test(t)) return l;
  return null;
}

export function ruleIntent(q) {
  const t = ` ${q.toLowerCase()} `;
  const has = (...w) => w.some((x) => t.includes(x));
  const intent = {
    categories: [], kids: false, maxMinutes: null, walkOnly: false, freeOnly: false, best: false, openNow: false, nearest: false,
    askCredits: false, askRaffle: false, askHow: false, lang: detectLang(q) || 'en',
  };
  for (const [cat, words] of Object.entries(CAT_WORDS)) if (words.some((w) => t.includes(w))) intent.categories.push(cat);
  intent.kids = has('kid', 'child', 'family', 'niño', 'nino', 'hijos', 'familia', 'criança', 'filhos', 'enfant', 'famille', 'kinder', 'familie');
  intent.walkOnly = has('walk', 'nearby', 'near me', 'caminando', 'cerca', 'a pie', 'a pé', 'perto', 'à pied', 'près', 'zu fuß', 'in der nähe');
  intent.nearest = has('closest', 'nearest', 'más cercano', 'mas cercano', 'mais perto', 'plus proche', 'nächste');
  intent.freeOnly = has('free', 'gratis', 'grátis', 'gratuit', 'kostenlos');
  intent.best = has('best', 'top', 'mejor', 'melhor', 'meilleur', 'beste');
  intent.openNow = has('open now', 'right now', 'abierto', 'aberto', 'ouvert', 'geöffnet', 'jetzt offen');
  intent.askCredits = has('credit', 'balance', 'crédito', 'credito', 'saldo', 'crédit', 'guthaben', 'punkte');
  intent.askRaffle = has('raffle', 'sorteo', 'rifa', 'draw', 'sorteio', 'tirage', 'loterie', 'verlosung', 'gewinnspiel');
  intent.askHow = has('how does', 'how do', 'how it works', 'cómo funciona', 'como funciona', 'comment ça marche', 'comment ca marche', 'wie funktioniert');
  const hm = t.match(/(\d+(?:[.,]\d+)?)\s*(hours?|hrs?|h\b|horas?|heures?|stunden?)/);
  const mm = t.match(/(\d+)\s*(minutes?|mins?|minutos?|minuten?)/);
  const words = { 60: ['one hour', 'an hour', 'una hora', 'uma hora', 'une heure', 'eine stunde'], 30: ['half an hour', 'media hora', 'meia hora', 'demi-heure', 'halbe stunde'], 120: ['two hours', 'dos horas', 'duas horas', 'deux heures', 'zwei stunden'], 180: ['afternoon', 'la tarde', 'a tarde', "l'après-midi", 'nachmittag'] };
  if (hm) intent.maxMinutes = Math.round(Number(hm[1].replace(',', '.')) * 60);
  else if (mm) intent.maxMinutes = Number(mm[1]);
  else for (const [m, ws] of Object.entries(words)) if (has(...ws)) { intent.maxMinutes = Number(m); break; }
  if (intent.maxMinutes) intent.openNow = true;
  return intent;
}

async function aiIntent(env, q, base) {
  if (!env.AI || q.length < 4) return base;
  try {
    const prompt = `Extract a treasure-hunt search intent from the traveler's message. Reply with JSON only, keys:
categories (array from ${JSON.stringify(Object.keys(CAT_WORDS))}), kids (bool), maxMinutes (number or null), walkOnly (bool),
freeOnly (bool), best (bool), openNow (bool), nearest (bool), askCredits (bool), askRaffle (bool), askHow (bool),
lang (one of ${JSON.stringify(LANGS)}).
Message: ${JSON.stringify(q)}`;
    const run = env.AI.run('@cf/meta/llama-3.1-8b-instruct', { messages: [{ role: 'user', content: prompt }], max_tokens: 200 });
    const out = await Promise.race([run, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 2500))]);
    const m = String(out?.response || '').match(/\{[\s\S]*\}/);
    if (!m) return base;
    const a = JSON.parse(m[0]);
    const cats = Array.isArray(a.categories) ? a.categories.filter((c) => CAT_WORDS[c]) : [];
    const yes = (k) => base[k] || a[k] === true;
    return {
      ...base,
      categories: base.categories.length ? base.categories : cats,
      kids: yes('kids'), walkOnly: yes('walkOnly'), best: yes('best'), openNow: yes('openNow'), nearest: yes('nearest'),
      askCredits: yes('askCredits'), askRaffle: yes('askRaffle'), askHow: yes('askHow'),
      maxMinutes: base.maxMinutes ?? (Number(a.maxMinutes) > 0 && Number(a.maxMinutes) <= 600 ? Math.round(a.maxMinutes) : null),
      lang: detectLang(q) || (LANGS.includes(a.lang) ? a.lang : base.lang),
      ai: true,
    };
  } catch { return base; }
}

// ---------- opening hours ----------

export function localMinutes(tz, now = new Date()) {
  try {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
    return Number(p.find((x) => x.type === 'hour').value) * 60 + Number(p.find((x) => x.type === 'minute').value);
  } catch { return now.getUTCHours() * 60 + now.getUTCMinutes(); }
}

// "09:00–18:00", "9:00-18:00", "12:00 - 01:00" (past midnight). Unknown → treat as open.
export function isOpen(hours, minutes) {
  const m = String(hours || '').match(/(\d{1,2}):(\d{2})\s*[–\-—to]+\s*(\d{1,2}):(\d{2})/);
  if (!m) return true;
  const a = Number(m[1]) * 60 + Number(m[2]), b = Number(m[3]) * 60 + Number(m[4]);
  if (a === b) return true;
  return a < b ? minutes >= a && minutes < b : minutes >= a || minutes < b;
}

// Greedy nearest-neighbour route that fits the time budget
// (walking + ~10 minutes at each stop).
export function planRoute(drops, start, minutes, stopMin = 10) {
  const left = drops.filter((d) => d.distanceM <= 2500).slice();
  const route = [];
  let here = start, used = 0;
  while (left.length) {
    left.forEach((d) => { d._m = distanceM(here.lat, here.lng, d.lat, d.lng); });
    left.sort((a, b) => a._m - b._m);
    const next = left[0];
    const cost = walkMin(next._m) + stopMin;
    if (used + cost > minutes) break;
    used += cost;
    route.push({ ...next, legMin: walkMin(next._m) });
    here = { lat: next.lat, lng: next.lng };
    left.shift();
  }
  route.forEach((d) => delete d._m);
  return { route, minutes: used };
}

// ---------- phrases ----------

const s = (n, one, many) => (n === 1 ? one : many);
const T = {
  en: {
    hello: "Hola! I'm Polly, your treasure guide. Tell me what you're in the mood for, who you're with, or how much time you have.",
    none: "I couldn't find a live treasure that matches. Try a wider search distance or another type.",
    found: (n, what) => `I found ${n} ${what}${s(n, '', 's')} for you. Closest first:`,
    nearest: 'The closest treasure to you right now:',
    route: (n, m, mins) => `Here's a ${mins % 60 === 0 ? `${mins / 60}-hour` : `${mins}-minute`} hunt: ${n} ${s(n, 'treasure', 'treasures')}, about ${m} minutes including walking and time at each stop. Start with the first one:`,
    routeNone: (m) => `${m} minutes is tight. Try the closest treasure first:`,
    credits: (b, t) => `You have ${b} Treasure Hunt credits and ${t} raffle ${s(t, 'ticket', 'tickets')} for Sunday's draw.`,
    raffle: (p, when) => `Every verified find this week is a ticket in the Sunday raffle for ${p} credits. Next draw: ${when} (2pm UTC).`,
    how: (c) => `Pick a treasure, tap Claim to get your code, and show it at the counter. When the merchant confirms, you earn ${c} credits and a raffle ticket. Then rate your visit.`,
    kids: 'kid-friendly treasure', treasure: 'treasure', walk: 'treasure within walking distance', open: 'treasure open now',
    best: 'Top-rated first:', signIn: 'Sign in so I can check your credits.',
    tipOpen: (t, m, d, h) => `Your code for ${t} is waiting at ${m}, ${d} away. It expires in ${h} ${s(h, 'hour', 'hours')}.`,
    tipMeal: { breakfast: 'Breakfast time!', lunch: "It's lunchtime!", afternoon: 'Afternoon treat?', evening: 'Evening on the island!' },
    tipNear: (lead, n, what, d) => `${lead} ${n} ${what}${s(n, '', 's')} within ${d}.`,
    tipRaffle: (h, p) => `The ${p}-credit raffle draws in ${h} ${s(h, 'hour', 'hours')}. One verified find gets you a ticket!`,
    tipStart: (n) => `${n} treasures are hidden nearby. Want me to plan a one-hour hunt?`,
  },
  es: {
    hello: '¡Hola! Soy Polly, tu guía de tesoros. Dime qué se te antoja, con quién vas o cuánto tiempo tienes.',
    none: 'No encontré un tesoro activo que coincida. Prueba una distancia mayor u otro tipo.',
    found: (n, what) => `Encontré ${n} ${what}${s(n, '', 's')} para ti. Los más cercanos primero:`,
    nearest: 'El tesoro más cercano a ti ahora mismo:',
    route: (n, m, mins) => `Aquí tienes una ruta de ${mins % 60 === 0 ? `${mins / 60} ${s(mins / 60, 'hora', 'horas')}` : `${mins} minutos`}: ${n} ${s(n, 'tesoro', 'tesoros')}, unos ${m} minutos con caminata y tiempo en cada parada. Empieza por el primero:`,
    routeNone: (m) => `${m} minutos es poco tiempo. Prueba primero el tesoro más cercano:`,
    credits: (b, t) => `Tienes ${b} créditos de Treasure Hunt y ${t} ${s(t, 'boleto', 'boletos')} para el sorteo del domingo.`,
    raffle: (p, when) => `Cada hallazgo verificado esta semana es un boleto para el sorteo del domingo de ${p} créditos. Próximo sorteo: ${when} (2pm UTC).`,
    how: (c) => `Elige un tesoro, toca Reclamar para obtener tu código y muéstralo en el mostrador. Cuando el comercio confirma, ganas ${c} créditos y un boleto. Luego califica tu visita.`,
    kids: 'tesoro para niños', treasure: 'tesoro', walk: 'tesoro a pie', open: 'tesoro abierto ahora',
    best: 'Los mejor calificados primero:', signIn: 'Inicia sesión para ver tus créditos.',
    tipOpen: (t, m, d, h) => `Tu código de ${t} te espera en ${m}, a ${d}. Vence en ${h} ${s(h, 'hora', 'horas')}.`,
    tipMeal: { breakfast: '¡Hora del desayuno!', lunch: '¡Hora de comer!', afternoon: '¿Un antojo por la tarde?', evening: '¡Noche en la isla!' },
    tipNear: (lead, n, what, d) => `${lead} ${n} ${what}${s(n, '', 's')} a menos de ${d}.`,
    tipRaffle: (h, p) => `El sorteo de ${p} créditos es en ${h} ${s(h, 'hora', 'horas')}. ¡Un hallazgo verificado te da un boleto!`,
    tipStart: (n) => `Hay ${n} tesoros escondidos cerca. ¿Te armo una ruta de una hora?`,
  },
  pt: {
    hello: 'Olá! Sou a Polly, sua guia de tesouros. Diga o que você quer, com quem está ou quanto tempo tem.',
    none: 'Não encontrei nenhum tesouro ativo assim. Tente uma distância maior ou outro tipo.',
    found: (n, what) => `Encontrei ${n} ${what}${s(n, '', 's')} para você. Os mais próximos primeiro:`,
    nearest: 'O tesouro mais perto de você agora:',
    route: (n, m, mins) => `Aqui está uma caça de ${mins % 60 === 0 ? `${mins / 60} ${s(mins / 60, 'hora', 'horas')}` : `${mins} minutos`}: ${n} ${s(n, 'tesouro', 'tesouros')}, cerca de ${m} minutos com caminhada e tempo em cada parada. Comece pelo primeiro:`,
    routeNone: (m) => `${m} minutos é pouco tempo. Tente primeiro o tesouro mais perto:`,
    credits: (b, t) => `Você tem ${b} créditos do Treasure Hunt e ${t} ${s(t, 'bilhete', 'bilhetes')} para o sorteio de domingo.`,
    raffle: (p, when) => `Cada achado verificado nesta semana é um bilhete para o sorteio de domingo de ${p} créditos. Próximo sorteio: ${when} (14h UTC).`,
    how: (c) => `Escolha um tesouro, toque em Resgatar para receber seu código e mostre no balcão. Quando o comerciante confirmar, você ganha ${c} créditos e um bilhete. Depois avalie a visita.`,
    kids: 'tesouro para crianças', treasure: 'tesouro', walk: 'tesouro a pé', open: 'tesouro aberto agora',
    best: 'Os mais bem avaliados primeiro:', signIn: 'Entre na sua conta para ver seus créditos.',
    tipOpen: (t, m, d, h) => `Seu código de ${t} está esperando em ${m}, a ${d}. Vence em ${h} ${s(h, 'hora', 'horas')}.`,
    tipMeal: { breakfast: 'Hora do café da manhã!', lunch: 'Hora do almoço!', afternoon: 'Um docinho à tarde?', evening: 'Noite na ilha!' },
    tipNear: (lead, n, what, d) => `${lead} ${n} ${what}${s(n, '', 's')} a menos de ${d}.`,
    tipRaffle: (h, p) => `O sorteio de ${p} créditos é daqui a ${h} ${s(h, 'hora', 'horas')}. Um achado verificado já vale um bilhete!`,
    tipStart: (n) => `Há ${n} tesouros escondidos por perto. Quer que eu monte uma caça de uma hora?`,
  },
  fr: {
    hello: 'Bonjour ! Je suis Polly, votre guide des trésors. Dites-moi ce qui vous fait envie, avec qui vous êtes ou combien de temps vous avez.',
    none: "Je n'ai trouvé aucun trésor actif qui corresponde. Essayez une distance plus grande ou un autre type.",
    found: (n, what) => `J'ai trouvé ${n} ${what}${s(n, '', 's')} pour vous. Les plus proches d'abord :`,
    nearest: 'Le trésor le plus proche de vous en ce moment :',
    route: (n, m, mins) => `Voici une chasse de ${mins % 60 === 0 ? `${mins / 60} ${s(mins / 60, 'heure', 'heures')}` : `${mins} minutes`} : ${n} ${s(n, 'trésor', 'trésors')}, environ ${m} minutes avec la marche et le temps à chaque arrêt. Commencez par le premier :`,
    routeNone: (m) => `${m} minutes, c'est court. Essayez d'abord le trésor le plus proche :`,
    credits: (b, t) => `Vous avez ${b} crédits Treasure Hunt et ${t} ${s(t, 'ticket', 'tickets')} pour le tirage de dimanche.`,
    raffle: (p, when) => `Chaque trouvaille vérifiée cette semaine est un ticket pour le tirage du dimanche de ${p} crédits. Prochain tirage : ${when} (14h UTC).`,
    how: (c) => `Choisissez un trésor, touchez Réclamer pour obtenir votre code et montrez-le au comptoir. Quand le commerçant confirme, vous gagnez ${c} crédits et un ticket. Ensuite, notez votre visite.`,
    kids: 'trésor pour enfants', treasure: 'trésor', walk: 'trésor à pied', open: 'trésor ouvert maintenant',
    best: "Les mieux notés d'abord :", signIn: 'Connectez-vous pour voir vos crédits.',
    tipOpen: (t, m, d, h) => `Votre code pour ${t} vous attend chez ${m}, à ${d}. Il expire dans ${h} ${s(h, 'heure', 'heures')}.`,
    tipMeal: { breakfast: "C'est l'heure du petit-déjeuner !", lunch: "C'est l'heure du déjeuner !", afternoon: 'Une douceur cet après-midi ?', evening: 'Soirée sur l’île !' },
    tipNear: (lead, n, what, d) => `${lead} ${n} ${what}${s(n, '', 's')} à moins de ${d}.`,
    tipRaffle: (h, p) => `Le tirage de ${p} crédits a lieu dans ${h} ${s(h, 'heure', 'heures')}. Une trouvaille vérifiée vous donne un ticket !`,
    tipStart: (n) => `${n} trésors sont cachés tout près. Je vous prépare une chasse d'une heure ?`,
  },
  de: {
    hello: 'Hallo! Ich bin Polly, deine Schatzführerin. Sag mir, worauf du Lust hast, mit wem du unterwegs bist oder wie viel Zeit du hast.',
    none: 'Ich habe keinen passenden Schatz gefunden. Versuch eine größere Entfernung oder eine andere Art.',
    found: (n, what) => `Ich habe ${n} ${n === 1 ? what : `${what.replace(/Schatz$/, 'Schätze')}`} für dich gefunden. Die nächsten zuerst:`,
    nearest: 'Der Schatz, der dir gerade am nächsten ist:',
    route: (n, m, mins) => `Hier ist eine ${mins % 60 === 0 ? `${mins / 60}-stündige` : `${mins}-minütige`} Schatzsuche: ${n} ${s(n, 'Schatz', 'Schätze')}, etwa ${m} Minuten mit Fußweg und Zeit an jedem Stopp. Fang mit dem ersten an:`,
    routeNone: (m) => `${m} Minuten sind knapp. Probier zuerst den nächsten Schatz:`,
    credits: (b, t) => `Du hast ${b} Treasure-Hunt-Credits und ${t} ${s(t, 'Los', 'Lose')} für die Verlosung am Sonntag.`,
    raffle: (p, when) => `Jeder bestätigte Fund in dieser Woche ist ein Los für die Sonntagsverlosung über ${p} Credits. Nächste Ziehung: ${when} (14 Uhr UTC).`,
    how: (c) => `Wähle einen Schatz, tippe auf Einlösen, um deinen Code zu bekommen, und zeig ihn an der Theke. Sobald der Händler bestätigt, bekommst du ${c} Credits und ein Los. Danach bewertest du deinen Besuch.`,
    kids: 'kinderfreundlichen Schatz', treasure: 'Schatz', walk: 'Schatz zu Fuß', open: 'jetzt geöffneten Schatz',
    best: 'Die bestbewerteten zuerst:', signIn: 'Melde dich an, damit ich deine Credits sehen kann.',
    tipOpen: (t, m, d, h) => `Dein Code für ${t} wartet bei ${m}, ${d} entfernt. Er läuft in ${h} ${s(h, 'Stunde', 'Stunden')} ab.`,
    tipMeal: { breakfast: 'Zeit fürs Frühstück!', lunch: 'Mittagszeit!', afternoon: 'Lust auf etwas Süßes?', evening: 'Abend auf der Insel!' },
    tipNear: (lead, n, what, d) => `${lead} ${n} ${n === 1 ? what : what.replace(/Schatz$/, 'Schätze')} im Umkreis von ${d}.`,
    tipRaffle: (h, p) => `Die Verlosung über ${p} Credits ist in ${h} ${s(h, 'Stunde', 'Stunden')}. Ein bestätigter Fund bringt dir ein Los!`,
    tipStart: (n) => `In der Nähe sind ${n} Schätze versteckt. Soll ich dir eine einstündige Schatzsuche planen?`,
  },
};
const catWord = { en: (c) => `${c.toLowerCase()} treasure`, es: (c) => `tesoro de ${{ Food: 'comida', Drink: 'bebida', Dessert: 'postre', Adventure: 'aventura', Shopping: 'compras', Mystery: 'misterio' }[c]}`,
  pt: (c) => `tesouro de ${{ Food: 'comida', Drink: 'bebida', Dessert: 'sobremesa', Adventure: 'aventura', Shopping: 'compras', Mystery: 'mistério' }[c]}`,
  fr: (c) => `trésor ${{ Food: 'gourmand', Drink: 'boisson', Dessert: 'dessert', Adventure: 'aventure', Shopping: 'shopping', Mystery: 'mystère' }[c]}`,
  de: (c) => `${{ Food: 'Essens', Drink: 'Getränke', Dessert: 'Dessert', Adventure: 'Abenteuer', Shopping: 'Shopping', Mystery: 'Mystery' }[c]}-Schatz` };
const LOCALE = { en: 'en-US', es: 'es-MX', pt: 'pt-BR', fr: 'fr-FR', de: 'de-DE' };
const fmtDist = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

const mini = (d, i, numbered) => ({
  id: d.id, n: numbered ? i + 1 : null, emoji: d.emoji, title: d.title, distanceM: d.distanceM, walkMin: d.walkMin, rating: d.rating, category: d.category,
});

async function context(env, user, destId, b) {
  const dest = await env.DB.prepare('SELECT * FROM destinations WHERE id = ?').bind(destId || 'cozumel').first();
  const here = Number.isFinite(b.lat) && Number.isFinite(b.lng) ? { lat: b.lat, lng: b.lng } : { lat: dest.center_lat, lng: dest.center_lng };
  let drops = await liveDrops(env, dest.id, here);
  const nowMin = localMinutes(dest.timezone || 'America/Cancun');
  drops.forEach((d) => { d.openNow = isOpen(d.hours, nowMin); });
  if (user) {
    const { results } = await env.DB.prepare(`SELECT drop_id FROM claims WHERE user_id = ? AND status = 'redeemed'`).bind(user.id).all();
    const done = new Set(results.map((r) => r.drop_id));
    drops = drops.filter((d) => !done.has(d.id));
  }
  return { dest, here, drops, nowMin };
}

export async function askPolly(req, env, user) {
  const b = await body(req, 5_000);
  const q = str(b.q, { min: 1, max: 400, name: 'Question' });
  let intent = await aiIntent(env, q, ruleIntent(q));
  // No language clues and not obviously English: answer in the account's language.
  if (!detectLang(q) && !intent.ai && user && LANGS.includes(user.language) && user.language !== 'en'
      && !/\b(the|what|where|how|find|show|want|have|treasures?|credits?|me|my|i)\b/i.test(q)) intent.lang = user.language;
  const L = T[intent.lang] || T.en;
  const set = await getSettings(env.DB);

  // Grand Treasure: Polly gives the progress and the clues that are open so far.
  if (/\b(scooter|grand|clues?|pistas?|premio|gran tesoro|jackpot|pot|bote)\b/i.test(q)) {
    const { grandForPolly } = await import('./grand.js');
    return json({ reply: await grandForPolly(env, intent.lang === 'es' ? 'es' : 'en'), intent, grand: true });
  }
  if (intent.askCredits) {
    if (!user) return json({ reply: L.signIn, intent });
    const bal = await env.DB.prepare('SELECT balance FROM treasure_hunt_credits WHERE user_id = ?').bind(user.id).first();
    const t = await env.DB.prepare('SELECT COUNT(*) n FROM redemptions WHERE user_id = ? AND redeemed_at >= ?').bind(user.id, iso(lastRaffleAt())).first();
    return json({ reply: L.credits(bal?.balance ?? 0, t.n), intent });
  }
  if (intent.askRaffle) {
    const when = nextRaffleAt().toLocaleDateString(LOCALE[intent.lang], { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
    return json({ reply: L.raffle(set.rafflePrize, when), intent });
  }
  if (intent.askHow) return json({ reply: L.how(set.creditsPerFind), intent });

  const { here, drops: all } = await context(env, user, b.destination, b);
  let drops = all;
  if (intent.categories.length) drops = drops.filter((d) => intent.categories.includes(d.category));
  if (intent.kids) drops = drops.filter((d) => d.kids);
  if (intent.walkOnly) drops = drops.filter((d) => d.distanceM <= 1500);
  if (intent.openNow) drops = drops.filter((d) => d.openNow);
  // Every treasure is free; "only free" simply means all live drops.

  if (!drops.length) return json({ reply: L.none, intent, drops: [] });

  if (intent.maxMinutes) {
    const { route, minutes } = planRoute(drops, here, intent.maxMinutes);
    if (!route.length) return json({ reply: L.routeNone(intent.maxMinutes), intent, drops: drops.slice(0, 1).map((d, i) => mini(d, i, false)) });
    return json({ reply: L.route(route.length, minutes, intent.maxMinutes), intent, route: true, drops: route.map((d, i) => mini(d, i, true)) });
  }
  if (intent.nearest) return json({ reply: L.nearest, intent, drops: drops.slice(0, 1).map((d, i) => mini(d, i, false)) });
  if (intent.best) {
    drops = drops.slice().sort((a, c) => (c.rating ?? 0) - (a.rating ?? 0));
    return json({ reply: L.best, intent, drops: drops.slice(0, 5).map((d, i) => mini(d, i, false)) });
  }
  const what = intent.kids ? L.kids : intent.walkOnly ? L.walk : intent.openNow ? L.open
    : intent.categories.length === 1 ? catWord[intent.lang](intent.categories[0]) : L.treasure;
  const greeting = /^(hi|hello|hey|hola|olá|ola|bonjour|salut|hallo)\b[!.\s]*$/i.test(q.trim());
  const reply = greeting ? L.hello : L.found(drops.length, what);
  return json({ reply, intent, drops: drops.slice(0, 5).map((d, i) => mini(d, i, false)) });
}

// Proactive tip for the Hunt screen. Most useful thing first.
export async function pollyTip(req, env, user) {
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get('lat')), lng = Number(url.searchParams.get('lng'));
  const b = url.searchParams.has('lat') && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : {};
  const lang = LANGS.includes(url.searchParams.get('lang')) ? url.searchParams.get('lang') : (user && LANGS.includes(user.language) ? user.language : 'en');
  const L = T[lang];
  const { dest, here, drops, nowMin } = await context(env, user, url.searchParams.get('destination'), b);
  const set = await getSettings(env.DB);

  // 1) An open code the explorer hasn't used yet.
  if (user) {
    const c = await env.DB.prepare(
      `SELECT c.expires_at, d.id, d.title, d.emoji, d.gps_lat, d.gps_lng, m.name AS merchant FROM claims c
         JOIN treasure_drops d ON d.id = c.drop_id JOIN merchants m ON m.id = d.merchant_id
        WHERE c.user_id = ? AND c.status = 'claimed' AND c.expires_at > ? ORDER BY c.expires_at LIMIT 1`).bind(user.id, iso(new Date())).first();
    if (c) {
      const h = Math.max(1, Math.round((Date.parse(c.expires_at) - Date.now()) / 3600e3));
      return json({ kind: 'open-code', text: L.tipOpen(c.title, c.merchant, fmtDist(distanceM(here.lat, here.lng, c.gps_lat, c.gps_lng)), h), dropId: c.id, emoji: c.emoji, action: 'qr' });
    }
  }
  // 2) Raffle closing soon (last 24 h) and no ticket yet.
  const toDraw = (nextRaffleAt().getTime() - Date.now()) / 3600e3;
  if (user && toDraw <= 24) {
    const t = await env.DB.prepare('SELECT COUNT(*) n FROM redemptions WHERE user_id = ? AND redeemed_at >= ?').bind(user.id, iso(lastRaffleAt())).first();
    if (!t.n && drops.length) return json({ kind: 'raffle', text: L.tipRaffle(Math.max(1, Math.round(toDraw)), set.rafflePrize), emoji: '🎟️', ask: nearestAsk(lang), drops: drops.slice(0, 3).map((d, i) => mini(d, i, false)) });
  }
  // 3) Meal-time treasures that are open now and close by.
  const slot = nowMin < 6 * 60 ? null : nowMin < 10.5 * 60 ? 'breakfast' : nowMin < 15 * 60 ? 'lunch' : nowMin < 18 * 60 ? 'afternoon' : 'evening';
  const cats = { breakfast: ['Drink', 'Food'], lunch: ['Food', 'Drink'], afternoon: ['Dessert', 'Adventure', 'Drink'], evening: ['Food', 'Drink', 'Dessert'] }[slot] || [];
  const near = drops.filter((d) => d.openNow && d.distanceM <= 1500);
  const meal = near.filter((d) => cats.includes(d.category));
  if (slot && meal.length) {
    const cat = cats.find((c) => meal.some((d) => d.category === c));
    const n = meal.filter((d) => d.category === cat).length;
    return json({ kind: 'meal', text: L.tipNear(L.tipMeal[slot], n, catWord[lang](cat), fmtDist(1500)), emoji: '🦜', drops: meal.filter((d) => d.category === cat).slice(0, 3).map((d, i) => mini(d, i, false)) });
  }
  // 4) Default: offer a one-hour hunt.
  if (drops.length) return json({ kind: 'start', text: L.tipStart(drops.length), emoji: '🦜', ask: { en: "Make today's hunt last one hour", es: 'Haz que la búsqueda de hoy dure una hora', pt: 'Faça a caça de hoje durar uma hora', fr: "Fais une chasse d'une heure aujourd'hui", de: 'Plane eine einstündige Schatzsuche' }[lang] });
  return json({ kind: 'none', text: L.none, emoji: '🦜', dest: dest.id });
}
const nearestAsk = (lang) => ({ en: 'What is the closest treasure?', es: '¿Cuál es el tesoro más cercano?', pt: 'Qual é o tesouro mais perto?', fr: 'Quel est le trésor le plus proche ?', de: 'Welcher Schatz ist am nächsten?' }[lang]);
