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

// Token bundles (one-time, pay-as-you-go) — must match scout-webhook.js exactly
const BUNDLES = {
  starter:  { name: 'Scout Starter',  tokens: 20,  price_cents: 500  },
  standard: { name: 'Scout Standard', tokens: 45,  price_cents: 1000 },
  pro:      { name: 'Scout Pro',      tokens: 120, price_cents: 2500 },
};

// Subscription plans (recurring monthly) — must match scout-webhook.js exactly
const PLANS = {
  plus: { name: 'Scout Plus', tokens_per_month: 40,  price_cents: 900  },
  pro:  { name: 'Scout Pro',  tokens_per_month: 100, price_cents: 1900 },
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

  const { bundle, plan } = req.body;

  const origin = req.headers.origin || `https://${req.headers.host}`;

  try {
    // ── Subscription checkout ──────────────────────────────────
    if (plan) {
      const selected = PLANS[plan];
      if (!selected) return res.status(400).json({ error: 'Invalid plan' });

      const session = await stripe.checkout.sessions.create({
        // Managed Payments (a newer Stripe default) requires every product
        // to carry a tax code, which we haven't set up (GST/HST status is
        // still undecided — see roadmap). Opt out of it for now so checkout
        // works with plain, untaxed prices, same as before it existed.
        managed_payments:      { enabled: false },
        payment_method_types:  ['card'],
        mode:                  'subscription',
        customer_email:        user.email,
        line_items: [{
          price_data: {
            currency:     'usd',
            unit_amount:  selected.price_cents,
            recurring:    { interval: 'month' },
            product_data: {
              name:        selected.name,
              description: `${selected.tokens_per_month} Scout Tokens every month`,
            },
          },
          quantity: 1,
        }],
        // Metadata on the subscription itself so the webhook can read it from
        // invoice events (invoices don't carry the checkout session's metadata).
        subscription_data: {
          metadata: { user_id: user.id, plan },
        },
        metadata: { user_id: user.id, plan },
        success_url: `${origin}/scout/app.html?subscription=success&plan=${plan}`,
        cancel_url:  `${origin}/scout/app.html?subscription=cancelled`,
      });

      return res.status(200).json({ url: session.url });
    }

    // ── One-time token bundle checkout ─────────────────────────
    const selected = BUNDLES[bundle];
    if (!selected) return res.status(400).json({ error: 'Invalid bundle' });

    const session = await stripe.checkout.sessions.create({
      managed_payments:      { enabled: false },
      payment_method_types:  ['card'],
      mode:                  'payment',
      customer_email:        user.email,
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
      success_url: `${origin}/scout/app.html?payment=success&tokens=${selected.tokens}`,
      cancel_url:  `${origin}/scout/app.html?payment=cancelled`,
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

  } catch (err) {
    console.error('Checkout error:', err);
    return res.status(500).json({ error: err.message || 'Checkout failed' });
  }
}
