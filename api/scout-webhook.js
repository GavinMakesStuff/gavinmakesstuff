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

  return res.status(200).json({ received: true });
}
