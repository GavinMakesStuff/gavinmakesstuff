// api/scout-webhook.js
// Handles Stripe webhooks — credits tokens when payment completes.
// Vercel env vars required:
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET   — from Stripe Dashboard → Webhooks
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe   = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Subscription plans — must match api/scout-checkout.js exactly
const PLANS = {
  plus: { tokens_per_month: 40 },
  pro:  { tokens_per_month: 100 },
};

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req);
  const sig     = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  // ── Handle checkout.session.completed ────────────────────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    // Subscription checkout: link the subscription to the user and set their
    // tier. Tokens are NOT credited here — Stripe always issues a first
    // invoice for a new subscription, so crediting happens once, in
    // invoice.paid, for both the first cycle and every renewal.
    if (session.mode === 'subscription') {
      const userId = session.metadata?.user_id;
      const plan   = session.metadata?.plan;

      if (!userId || !PLANS[plan]) {
        console.error('Missing/invalid subscription metadata in session:', session.id);
        return res.status(200).json({ received: true });
      }

      await supabase
        .from('profiles')
        .update({
          tier:                  plan,
          stripe_customer_id:    session.customer,
          stripe_subscription_id: session.subscription,
        })
        .eq('id', userId);

      console.log(`User ${userId} subscribed to ${plan}`);
      return res.status(200).json({ received: true });
    }

    // One-time token bundle checkout
    const userId  = session.metadata?.user_id;
    const tokens  = parseInt(session.metadata?.tokens  || '0', 10);
    const bundle  = session.metadata?.bundle || 'unknown';

    if (!userId || !tokens) {
      console.error('Missing metadata in Stripe session:', session.id);
      return res.status(200).json({ received: true }); // ack to avoid retries
    }

    // Idempotency: check if already processed
    const { data: existing } = await supabase
      .from('transactions')
      .select('id, status')
      .eq('stripe_session_id', session.id)
      .single();

    if (existing?.status === 'completed') {
      return res.status(200).json({ received: true, note: 'already processed' });
    }

    // Credit tokens to user
    await supabase.rpc('credit_tokens', {
      p_user_id: userId,
      p_amount:  tokens,
      p_reason:  `stripe_${bundle}`,
    });

    // Update transaction record
    await supabase
      .from('transactions')
      .update({
        status:           'completed',
        stripe_payment_id: session.payment_intent,
      })
      .eq('stripe_session_id', session.id);

    console.log(`Credited ${tokens} tokens to user ${userId}`);
  }

  // ── Handle invoice.paid: credit monthly tokens (first cycle + renewals) ──
  if (event.type === 'invoice.paid') {
    const invoice = event.data.object;
    const subscriptionId = invoice.subscription;

    if (!subscriptionId) {
      return res.status(200).json({ received: true }); // not a subscription invoice
    }

    // Idempotency: one credit per invoice
    const { data: existing } = await supabase
      .from('transactions')
      .select('id, status')
      .eq('stripe_session_id', invoice.id)
      .single();

    if (existing?.status === 'completed') {
      return res.status(200).json({ received: true, note: 'already processed' });
    }

    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const userId = subscription.metadata?.user_id;
    const plan   = subscription.metadata?.plan;
    const planDef = PLANS[plan];

    if (!userId || !planDef) {
      console.error('Missing/invalid subscription metadata on subscription:', subscriptionId);
      return res.status(200).json({ received: true });
    }

    await supabase.rpc('credit_tokens', {
      p_user_id: userId,
      p_amount:  planDef.tokens_per_month,
      p_reason:  `stripe_sub_${plan}`,
    });

    // Defensive: keep tier in sync in case checkout.session.completed hasn't landed yet
    await supabase
      .from('profiles')
      .update({ tier: plan, stripe_subscription_id: subscriptionId })
      .eq('id', userId);

    await supabase.from('transactions').insert({
      user_id:            userId,
      amount_usd:         (invoice.amount_paid || 0) / 100,
      tokens_purchased:   planDef.tokens_per_month,
      stripe_session_id:  invoice.id,
      stripe_payment_id:  invoice.payment_intent,
      status:             'completed',
    });

    console.log(`Credited ${planDef.tokens_per_month} tokens to user ${userId} for ${plan} renewal`);
  }

  // ── Handle subscription cancellation ─────────────────────
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const userId = subscription.metadata?.user_id;

    if (!userId) {
      console.error('Missing user_id metadata on cancelled subscription:', subscription.id);
      return res.status(200).json({ received: true });
    }

    // Downgrade to pay-as-you-go — any unused token balance stays usable,
    // it just stops refilling monthly.
    await supabase
      .from('profiles')
      .update({ tier: 'paid', stripe_subscription_id: null })
      .eq('id', userId);

    console.log(`Subscription cancelled for user ${userId}, downgraded to pay-as-you-go`);
  }

  return res.status(200).json({ received: true });
}
