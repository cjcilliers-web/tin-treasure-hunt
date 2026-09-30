// Phase 3 — Polly, the natural-language guide for Treasure Hunt discovery.
//
// How it works:
//   1. Understand the question -> a small "intent" object. Built-in rules
//      always run; if the Workers AI binding exists, the model refines the
//      intent for free-form questions (it never invents treasures).
//   2. Answer from real data: live drops, distance, hours, ratings, the
//      traveler's credits and what they already found.
import { body, json, str, distanceM, walkMin, nextRaffleAt, iso, getSettings } from './lib.js';
import { liveDrops } from './hunt.js';

const CAT_WORDS = {
  Food: ['food', 'eat', 'hungry', 'taco', 'burger', 'lunch', 'dinner', 'breakfast', 'comida', 'comer', 'hambre'],
  Drink: ['drink', 'coffee', 'café', 'cafe', 'beer', 'cocktail', 'thirsty', 'bebida', 'cerveza', 'tomar'],
  Dessert: ['dessert', 'sweet', 'ice cream', 'chocolate', 'helado', 'postre', 'dulce'],
  Adventure: ['adventure', 'snorkel', 'dive', 'kayak', 'beach', 'scooter', 'tour', 'aventura', 'playa', 'bucear'],
  Shopping: ['shop', 'shopping', 'souvenir', 'gift', 'jewel', 'compras', 'regalo', 'tienda'],
  Mystery: ['mystery', 'surprise', 'secret', 'misterio', 'sorpresa'],
};

export function ruleIntent(q) {
  const t = ` ${q.toLowerCase()} `;
  const has = (...w) => w.some((x) => t.includes(x));
  const intent = { categories: [], kids: false, maxMinutes: null, walkOnly: false, freeOnly: false, best: false,
    askCredits: false, askRaffle: false, askHow: false, lang: /[¿¡ñ]|\b(quiero|tengo|dónde|donde|niños|hola|tesoro|cerca|créditos|creditos)\b/.test(t) ? 'es' : 'en' };
  for (const [cat, words] of Object.entries(CAT_WORDS)) if (words.some((w) => t.includes(w))) intent.categories.push(cat);
  intent.kids = has('kid', 'child', 'family', 'niño', 'nino', 'hijos', 'familia');
  intent.walkOnly = has('walk', 'nearby', 'close', 'near me', 'caminando', 'cerca', 'a pie');
  intent.freeOnly = has('free', 'gratis');
  intent.best = has('best', 'top', 'mejor');
  intent.askCredits = has('credit', 'balance', 'crédito', 'credito', 'saldo');
  intent.askRaffle = has('raffle', 'sorteo', 'rifa', 'draw');
  intent.askHow = has('how does', 'how do', 'how it works', 'cómo funciona', 'como funciona');
  const hm = t.match(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h\b|horas?)/);
  const mm = t.match(/(\d+)\s*(minutes?|mins?|minutos?)/);
  if (hm) intent.maxMinutes = Math.round(Number(hm[1]) * 60);
  else if (mm) intent.maxMinutes = Number(mm[1]);
  else if (has('one hour', 'an hour', 'una hora')) intent.maxMinutes = 60;
  else if (has('half an hour', 'media hora')) intent.maxMinutes = 30;
  else if (has('two hours', 'dos horas')) intent.maxMinutes = 120;
  else if (has('afternoon', 'tarde')) intent.maxMinutes = 180;
  return intent;
}

async function aiIntent(env, q, base) {
  if (!env.AI || q.length < 4) return base;
  try {
    const prompt = `Extract a treasure-hunt search intent from the traveler's message. Reply with JSON only, keys:
categories (array from ${JSON.stringify(Object.keys(CAT_WORDS))}), kids (bool), maxMinutes (number or null), walkOnly (bool),
freeOnly (bool), best (bool), askCredits (bool), askRaffle (bool), askHow (bool), lang ("en" or "es").
Message: ${JSON.stringify(q)}`;
    const run = env.AI.run('@cf/meta/llama-3.1-8b-instruct', { messages: [{ role: 'user', content: prompt }], max_tokens: 200 });
    const out = await Promise.race([run, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 2500))]);
    const m = String(out?.response || '').match(/\{[\s\S]*\}/);
    if (!m) return base;
    const a = JSON.parse(m[0]);
    const cats = Array.isArray(a.categories) ? a.categories.filter((c) => CAT_WORDS[c]) : [];
    return {
      ...base,
      categories: base.categories.length ? base.categories : cats,
      kids: base.kids || a.kids === true,
      maxMinutes: base.maxMinutes ?? (Number(a.maxMinutes) > 0 && Number(a.maxMinutes) <= 600 ? Math.round(a.maxMinutes) : null),
      walkOnly: base.walkOnly || a.walkOnly === true,
      best: base.best || a.best === true,
      askCredits: base.askCredits || a.askCredits === true,
      askRaffle: base.askRaffle || a.askRaffle === true,
      askHow: base.askHow || a.askHow === true,
      lang: a.lang === 'es' ? 'es' : base.lang,
      ai: true,
    };
  } catch { return base; }
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

const T = {
  en: {
    hello: "Hola! I'm Polly, your treasure guide. Tell me what you're in the mood for, who you're with, or how much time you have.",
    none: "I couldn't find a live treasure that matches. Try a wider search distance or another type.",
    found: (n, what) => `I found ${n} ${what}${n === 1 ? '' : 's'} for you. Closest first:`,
    route: (n, m, h) => `Here's a ${h}: ${n} treasure${n === 1 ? '' : 's'}, about ${m} minutes including walking and time at each stop. Start with the first one:`,
    routeNone: (m) => `${m} minutes is tight. Try the closest treasure first:`,
    credits: (b, t) => `You have ${b} Treasure Hunt credits. You have ${t} raffle ticket${t === 1 ? '' : 's'} for Sunday's draw.`,
    raffle: (p, when) => `Every verified find this week is a ticket in the Sunday raffle for ${p} credits. Next draw: ${when} (2pm UTC).`,
    how: (c) => `Pick a treasure, tap Claim to get your code, and show it at the counter. When the merchant confirms, you earn ${c} credits and a raffle ticket. Then rate your visit.`,
    kids: 'kid-friendly treasure',
    treasure: 'treasure',
    walk: 'treasure within walking distance',
    best: 'Top-rated first:',
    signIn: 'Sign in so I can check your credits.',
  },
  es: {
    hello: '¡Hola! Soy Polly, tu guía de tesoros. Dime qué se te antoja, con quién vas o cuánto tiempo tienes.',
    none: 'No encontré un tesoro activo que coincida. Prueba una distancia mayor u otro tipo.',
    found: (n, what) => `Encontré ${n} ${what}${n === 1 ? '' : 's'} para ti. Los más cercanos primero:`,
    route: (n, m, h) => `Aquí tienes una ${h}: ${n} tesoro${n === 1 ? '' : 's'}, unos ${m} minutos con caminata y tiempo en cada parada. Empieza por el primero:`,
    routeNone: (m) => `${m} minutos es poco tiempo. Prueba primero el tesoro más cercano:`,
    credits: (b, t) => `Tienes ${b} créditos de Treasure Hunt y ${t} boleto${t === 1 ? '' : 's'} para el sorteo del domingo.`,
    raffle: (p, when) => `Cada hallazgo verificado esta semana es un boleto para el sorteo del domingo de ${p} créditos. Próximo sorteo: ${when} (2pm UTC).`,
    how: (c) => `Elige un tesoro, toca Reclamar para obtener tu código y muéstralo en el mostrador. Cuando el comercio confirma, ganas ${c} créditos y un boleto. Luego califica tu visita.`,
    kids: 'tesoro para niños',
    treasure: 'tesoro',
    walk: 'tesoro a pie',
    best: 'Los mejor calificados primero:',
    signIn: 'Inicia sesión para ver tus créditos.',
  },
};

const mini = (d, i, numbered) => ({
  id: d.id, n: numbered ? i + 1 : null, emoji: d.emoji, title: d.title, distanceM: d.distanceM, walkMin: d.walkMin, rating: d.rating, category: d.category,
});

export async function askPolly(req, env, user) {
  const b = await body(req, 5_000);
  const q = str(b.q, { min: 1, max: 400, name: 'Question' });
  const destId = typeof b.destination === 'string' ? b.destination : 'cozumel';
  const dest = await env.DB.prepare('SELECT * FROM destinations WHERE id = ?').bind(destId).first();
  const here = Number.isFinite(b.lat) && Number.isFinite(b.lng) ? { lat: b.lat, lng: b.lng } : { lat: dest.center_lat, lng: dest.center_lng };
  let intent = await aiIntent(env, q, ruleIntent(q));
  if (!/[¿¡ñ]|\b(quiero|tengo|hola)\b/i.test(q) && !intent.ai && user?.language === 'es') intent.lang = 'es';
  const L = T[intent.lang] || T.en;
  const s = await getSettings(env.DB);

  if (intent.askCredits) {
    if (!user) return json({ reply: L.signIn, intent });
    const bal = await env.DB.prepare('SELECT balance FROM treasure_hunt_credits WHERE user_id = ?').bind(user.id).first();
    const since = iso(new Date(nextRaffleAt().getTime() - 7 * 86400e3));
    const t = await env.DB.prepare('SELECT COUNT(*) n FROM redemptions WHERE user_id = ? AND redeemed_at >= ?').bind(user.id, since).first();
    return json({ reply: L.credits(bal?.balance ?? 0, t.n), intent });
  }
  if (intent.askRaffle) {
    const when = nextRaffleAt().toLocaleDateString(intent.lang === 'es' ? 'es-MX' : 'en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
    return json({ reply: L.raffle(s.rafflePrize, when), intent });
  }
  if (intent.askHow) return json({ reply: L.how(s.creditsPerFind), intent });

  let drops = await liveDrops(env, dest.id, here);
  if (user) {
    const { results } = await env.DB.prepare(`SELECT drop_id FROM claims WHERE user_id = ? AND status = 'redeemed'`).bind(user.id).all();
    const done = new Set(results.map((r) => r.drop_id));
    drops = drops.filter((d) => !done.has(d.id));
  }
  if (intent.categories.length) drops = drops.filter((d) => intent.categories.includes(d.category));
  if (intent.kids) drops = drops.filter((d) => d.kids);
  if (intent.walkOnly) drops = drops.filter((d) => d.distanceM <= 1500);
  // Every treasure is free; "only free" simply means all live drops.

  if (!drops.length) return json({ reply: L.none, intent, drops: [] });

  if (intent.maxMinutes) {
    const { route, minutes } = planRoute(drops, here, intent.maxMinutes);
    if (!route.length) return json({ reply: L.routeNone(intent.maxMinutes), intent, drops: drops.slice(0, 1).map((d, i) => mini(d, i, false)) });
    const label = intent.lang === 'es'
      ? `ruta de ${intent.maxMinutes >= 60 && intent.maxMinutes % 60 === 0 ? `${intent.maxMinutes / 60} hora${intent.maxMinutes === 60 ? '' : 's'}` : `${intent.maxMinutes} minutos`}`
      : `${intent.maxMinutes >= 60 && intent.maxMinutes % 60 === 0 ? `${intent.maxMinutes / 60}-hour` : `${intent.maxMinutes}-minute`} hunt`;
    return json({ reply: L.route(route.length, minutes, label), intent, route: true, drops: route.map((d, i) => mini(d, i, true)) });
  }

  if (intent.best) {
    drops.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    return json({ reply: L.best, intent, drops: drops.slice(0, 5).map((d, i) => mini(d, i, false)) });
  }
  const what = intent.kids ? L.kids : intent.walkOnly ? L.walk
    : intent.categories.length === 1 ? `${intent.categories[0].toLowerCase()} ${L.treasure}` : L.treasure;
  const reply = /^(hi|hello|hola|hey)\b/i.test(q.trim()) && q.trim().length < 12 ? L.hello : L.found(drops.length, what);
  return json({ reply, intent, drops: drops.slice(0, 5).map((d, i) => mini(d, i, false)) });
}
