require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors()); // allow requests from your storefront
app.use(bodyParser.json());

const SHOP = process.env.SHOPIFY_SHOP; // 'your-shop.myshopify.com'
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN; // Admin API access token from Custom App
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';

if (!SHOP || !TOKEN) {
  console.error('Missing SHOPIFY_SHOP or SHOPIFY_ACCESS_TOKEN in environment');
  process.exit(1);
}

async function createDraftOrderOnShopify(payload) {
  const endpoint = `https://${SHOP}/admin/api/${API_VERSION}/draft_orders.json`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN,
      'Accept': 'application/json'
    },
    body: JSON.stringify({ draft_order: payload })
  });

  if (res.status === 202) {
    const location = res.headers.get('location');
    if (!location) throw new Error('Shopify returned 202 with no Location header.');
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 800));
      const poll = await fetch(location, {
        method: 'GET',
        headers: { 'X-Shopify-Access-Token': TOKEN, 'Accept': 'application/json' }
      });
      if (!poll.ok) continue;
      const pj = await poll.json();
      if (pj && pj.draft_order && pj.draft_order.invoice_url) return pj.draft_order;
    }
    throw new Error('Timeout waiting for draft order calculations.');
  }

  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json.draft_order;
}

app.post('/create-draft-order', async (req, res) => {
  try {
    const { items, discount_percentage } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items required' });
    }
    const line_items = items.map(it => ({ variant_id: Number(it.variant_id), quantity: Number(it.quantity || 1) }));
    const draftPayload = { line_items };
    const pct = Number(discount_percentage || 0);
    if (pct > 0) {
      draftPayload.applied_discount = {
        title: 'Bundle discount',
        description: `Bundle ${pct}% off`,
        value: String(pct),
        value_type: 'percentage'
      };
    }
    const draft = await createDraftOrderOnShopify(draftPayload);
    return res.json({ invoice_url: draft.invoice_url, draft_order: draft });
  } catch (err) {
    console.error('create-draft-order error', String(err));
    return res.status(500).json({ error: 'server_error', details: String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log(`Draft order server running on port ${PORT}`));
