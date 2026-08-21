// api/scout-cancel-subscription.js
// Cancels the caller's Scout Plus/Pro subscription at the end of the
// current billing period — they keep access (and any token balance) through
// what they already paid for, then move to pay-as-you-go automatically.
// The existing customer.subscription.deleted webhook handles the actual
// tier downgrade when Stripe closes the subscription out at period end.
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

// Newer Stripe API versions moved current_period_end off the subscription's
// top level and onto each subscription item instead (part of flexible-
// billing support for multi-item subscriptions) — same relocation
// scout-webhook.js already works around for invoice.subscription. Scout's
// subscriptions only ever have one item, so items.data[0] is always the
// right one to read here.
function resolvePeriodEnd(subscription) {
  return subscription.current_period_end
    ?? subscription.items?.data?.[0]?.current_period_end
    ?? null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid session' });

  const { data: profile } = await supabase
    .from('profiles')
    .select('tier, stripe_subscription_id')
    .eq('id', user.id)
    .single();

  if (!profile?.stripe_subscription_id || (profile.tier !== 'plus' && profile.tier !== 'pro')) {
    return res.status(400).json({ error: 'No active subscription to cancel.' });
  }

  try {
    const subscription = await stripe.subscriptions.update(profile.stripe_subscription_id, {
      cancel_at_period_end: true,
    });
    const periodEnd = resolvePeriodEnd(subscription);
    return res.status(200).json({
      ok: true,
      endsAt: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    });
  } catch (err) {
    console.error('Cancel subscription error:', err);
    // Same stale-subscription-id possibility as scout-checkout.js — if
    // Stripe can't find it, there's nothing left to cancel from Stripe's
    // side, so just clear the tier locally rather than leaving the user
    // stuck paying for something Stripe no longer knows about.
    if (err.code === 'resource_missing') {
      await supabase.from('profiles').update({ tier: 'paid', stripe_subscription_id: null }).eq('id', user.id);
      return res.status(200).json({ ok: true, endsAt: null });
    }
    return res.status(500).json({ error: err.message || 'Could not cancel subscription.' });
  }
}
