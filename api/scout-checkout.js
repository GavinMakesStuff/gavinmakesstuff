// api/scout-checkout.js
// Creates a Stripe Checkout session for token bundle purchases.
// Vercel env vars required:
//   STRIPE_SECRET_KEY       — Stripe secret key
//   SUPABASE_URL            — Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe   = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Token bundles — must match STRIPE_WEBHOOK exactly
const BUNDLES = {
  starter:  { name: 'Scout Starter',  tokens: 20,  price_cents: 500  },
  standard: { name: 'Scout Standard', tokens: 45,  price_cents: 1000 },
  pro:      { name: 'Scout Pro',      tokens: 120, price_cents: 2500 },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Verify JWT ────────────────────────────────────────────
  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid session' });

  // ── Validate bundle ───────────────────────────────────────
  const { bundle } = req.body;
  const selected   = BUNDLES[bundle];
  if (!selected) return res.status(400).json({ error: 'Invalid bundle' });

  // ── Create Stripe session ─────────────────────────────────
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode:                 'payment',
    customer_email:       user.email,
    line_items: [{
      price_data: {
        currency:     'usd',
        unit_amount:  selected.price_cents,
        product_data: {
          name:        selected.name,
          description: `${selected.tokens} Scout Tokens — ${selected.tokens} job analyses`,
        },
      },
      quantity: 1,
    }],
    metadata: {
      user_id:  user.id,
      bundle:   bundle,
      tokens:   selected.tokens.toString(),
    },
    success_url: `${req.headers.origin}/scout/?payment=success&tokens=${selected.tokens}`,
    cancel_url:  `${req.headers.origin}/scout/?payment=cancelled`,
  });

  // ── Record pending transaction ────────────────────────────
  await supabase.from('transactions').insert({
    user_id:           user.id,
    amount_usd:        selected.price_cents / 100,
    tokens_purchased:  selected.tokens,
    stripe_session_id: session.id,
    status:            'pending',
  });

  return res.status(200).json({ url: session.url });
}
