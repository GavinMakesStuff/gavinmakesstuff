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

  // ── Idempotency guard ──────────────────────────────────────
  // Stripe retries on any non-2xx response and can occasionally deliver an
  // event twice outright. The per-type checks below (look up `transactions`
  // by stripe_session_id) are check-then-act and have a real race window —
  // two concurrent deliveries of the same event could both pass "not yet
  // completed" before either finishes writing, double-crediting tokens.
  // This INSERT is the atomic fix: stripe_processed_events.event_id is a
  // primary key, so the first delivery wins the insert and any retry/
  // concurrent duplicate hits a unique-violation and is skipped before any
  // side effect runs. Fails OPEN on any other error (e.g. the migration
  // hasn't been run yet) — a missing safety table should never block real
  // payment processing.
  const { error: dedupeError } = await supabase
    .from('stripe_processed_events')
    .insert({ event_id: event.id, event_type: event.type });

  if (dedupeError) {
    if (dedupeError.code === '23505') { // unique_violation — genuine duplicate
      console.log(`Duplicate webhook delivery for event ${event.id} (${event.type}), skipping`);
      return res.status(200).json({ received: true, note: 'duplicate event' });
    }
    console.warn('stripe_processed_events insert failed (non-fatal, proceeding):', dedupeError.message);
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

    // Newer Stripe API versions moved the subscription link off the
    // top-level `subscription` field and onto `parent.subscription_details`.
    // Check both so this keeps working regardless of API version.
    const subscriptionId =
      invoice.subscription ||
      invoice.parent?.subscription_details?.subscription ||
      null;

    console.log(`invoice.paid received: invoice=${invoice.id} resolvedSubscriptionId=${subscriptionId}`);

    if (!subscriptionId) {
      console.log('invoice.paid: no subscription id found on invoice, treating as non-subscription invoice. Raw keys:', Object.keys(invoice).join(', '));
      return res.status(200).json({ received: true }); // not a subscription invoice
    }

    // Idempotency: one credit per invoice
    const { data: existing } = await supabase
      .from('transactions')
      .select('id, status')
      .eq('stripe_session_id', invoice.id)
      .single();

    if (existing?.status === 'completed') {
      console.log(`invoice.paid: invoice ${invoice.id} already processed, skipping`);
      return res.status(200).json({ received: true, note: 'already processed' });
    }

    // Metadata may also be mirrored directly onto the invoice in newer API
    // versions — check that first, fall back to retrieving the subscription.
    let userId = invoice.parent?.subscription_details?.metadata?.user_id;
    let plan   = invoice.parent?.subscription_details?.metadata?.plan;

    if (!userId || !plan) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      userId = userId || subscription.metadata?.user_id;
      plan   = plan   || subscription.metadata?.plan;
    }

    const planDef = PLANS[plan];

    if (!userId || !planDef) {
      console.error(`invoice.paid: missing/invalid subscription metadata. subscriptionId=${subscriptionId} userId=${userId} plan=${plan}`);
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
