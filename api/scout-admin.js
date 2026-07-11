// api/scout-admin.js
// Admin-only API for token management and user administration.
// All operations require a VIP JWT. Uses service_role to bypass RLS.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // ── Verify VIP JWT ────────────────────────────────────────
  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid session' });

  const { data: profile } = await supabase
    .from('profiles').select('tier').eq('id', user.id).single();
  if (profile?.tier !== 'vip') return res.status(403).json({ error: 'VIP access required' });

  const { action, email, delta, reason, tier, bundle } = req.body;

  // ── Helper: get user by email ─────────────────────────────
  async function getUserByEmail(e) {
    const { data } = await supabase
      .from('profiles')
      .select('id, email, tier')
      .eq('email', e)
      .single();
    return data;
  }

  // ── Actions ───────────────────────────────────────────────
  try {
    if (action === 'lookup') {
      const target = await getUserByEmail(email);
      if (!target) return res.json({ error: 'User not found' });

      const { data: balance } = await supabase
        .from('token_balances')
        .select('balance, lifetime_purchased, lifetime_used')
        .eq('user_id', target.id).single();

      const { data: usage } = await supabase
        .from('daily_usage')
        .select('analyses_count')
        .eq('user_id', target.id)
        .eq('usage_date', new Date().toISOString().slice(0,10))
        .single();

      return res.json({
        email:             target.email,
        tier:              target.tier,
        token_balance:     balance?.balance            || 0,
        lifetime_purchased:balance?.lifetime_purchased  || 0,
        lifetime_used:     balance?.lifetime_used       || 0,
        today_analyses:    usage?.analyses_count        || 0,
        user_id:           target.id,
      });
    }

    if (action === 'adjust_tokens') {
      const target = await getUserByEmail(email);
      if (!target) return res.json({ error: 'User not found' });

      await supabase.rpc('admin_adjust_tokens', {
        p_user_id: target.id,
        p_delta:   parseInt(delta, 10),
        p_reason:  reason || 'admin_manual',
      });

      const { data: newBal } = await supabase
        .from('token_balances').select('balance').eq('user_id', target.id).single();

      return res.json({ ok: true, new_balance: newBal?.balance || 0 });
    }

    if (action === 'set_tier') {
      const target = await getUserByEmail(email);
      if (!target) return res.json({ error: 'User not found' });

      await supabase
        .from('profiles')
        .update({ tier, updated_at: new Date().toISOString() })
        .eq('id', target.id);

      return res.json({ ok: true });
    }

    if (action === 'recent_adjustments') {
      const { data: adjustments } = await supabase
        .from('admin_adjustments')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      return res.json({ adjustments: adjustments || [] });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });

  } catch (err) {
    console.error('Admin error:', err);
    return res.status(500).json({ error: err.message });
  }
}
