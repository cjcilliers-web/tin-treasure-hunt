// Tiny stand-in for the Stripe API, used only by the local e2e test.
const http = require('http');
const sessions = {};
http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const send = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.method === 'POST' && req.url === '/v1/checkout/sessions') {
      const p = new URLSearchParams(b); const id = `cs_test_${Date.now()}`;
      sessions[id] = { id, success: p.get('success_url').replace('{CHECKOUT_SESSION_ID}', id), amount: Number(p.get('line_items[0][price_data][unit_amount]')) * Number(p.get('line_items[0][quantity]')), paid: false };
      return send({ id, url: `http://localhost:8799/pay/${id}` });
    }
    let m = req.url.match(/^\/v1\/checkout\/sessions\/(cs_\w+)$/);
    if (m) { const s = sessions[m[1]]; return send({ id: s.id, status: s.paid ? 'complete' : 'open', payment_status: s.paid ? 'paid' : 'unpaid', payment_intent: 'pi_test' }); }
    m = req.url.match(/^\/pay\/(cs_\w+)$/);
    if (m) { const s = sessions[m[1]]; res.writeHead(200, { 'content-type': 'text/html' }); return res.end(`<h1>Mock Stripe</h1><p>Amount: $${(s.amount / 100).toFixed(2)}</p><a id="paybtn" href="/done/${s.id}">Pay</a>`); }
    m = req.url.match(/^\/done\/(cs_\w+)$/);
    if (m) { const s = sessions[m[1]]; s.paid = true; res.writeHead(302, { location: s.success }); return res.end(); }
    res.writeHead(404); res.end();
  });
}).listen(8799, () => console.log('mock stripe on 8799'));
