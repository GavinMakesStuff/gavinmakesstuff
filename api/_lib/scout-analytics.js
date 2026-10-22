// Scout insights: the rules and request handling for opt-in analytics.
// Spec: docs/superpowers/specs/2026-10-22-scout-insights-foundation-design.md
//
// Everything here is pure or takes the Supabase client as a parameter, so it
// can be tested without a server. api/scout-ai.js only wires requests to it.
//
// What is NOT allowed to happen in this file:
//   * logging an event payload or a database error body (they may contain data)
//   * returning a database error message to the client
//   * accepting any event type or property that is not in EVENT_REGISTRY

export const ANALYTICS_POLICY_VERSION = '2026-10-22';
export const MAX_EVENTS_PER_REQUEST = 50;

// Allowed events. Property kinds: enum (fixed list), int (bounded), bool.
// There is deliberately no string kind: free text must never enter the store.
// Later sub-projects add their event types here, nowhere else.
export const EVENT_REGISTRY = {
  app_open: { props: { view: { kind: 'enum', values: ['results', 'saved', 'applied', 'profile'] } } },
};

function checkProp(spec, value) {
  if (spec.kind === 'enum') return typeof value === 'string' && spec.values.includes(value);
  if (spec.kind === 'int')  return Number.isInteger(value) && value >= spec.min && value <= spec.max;
  if (spec.kind === 'bool') return typeof value === 'boolean';
  return false;
}

export function validateEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return { ok: false, error: 'events must be a non-empty list' };
  if (events.length > MAX_EVENTS_PER_REQUEST) return { ok: false, error: 'too many events in one request' };

  const clean = [];
  for (const ev of events) {
    if (!ev || typeof ev !== 'object' || typeof ev.type !== 'string') return { ok: false, error: 'invalid event' };
    // Own-property check: 'constructor', '__proto__', 'toString' must not pass.
    if (!Object.prototype.hasOwnProperty.call(EVENT_REGISTRY, ev.type)) return { ok: false, error: 'unknown event type' };
    const def = EVENT_REGISTRY[ev.type];
    const props = ev.props;
    if (!props || typeof props !== 'object' || Array.isArray(props)) return { ok: false, error: 'invalid properties' };

    for (const key of Object.keys(props)) {
      if (!Object.prototype.hasOwnProperty.call(def.props, key)) return { ok: false, error: 'unknown property' };
    }
    const outProps = {};
    for (const [key, spec] of Object.entries(def.props)) {
      if (!Object.prototype.hasOwnProperty.call(props, key)) {
        if (spec.optional) continue;
        return { ok: false, error: 'missing property' };
      }
      if (!checkProp(spec, props[key])) return { ok: false, error: 'invalid property value' };
      outProps[key] = props[key];
    }
    clean.push({ type: ev.type, props: outProps });
  }
  return { ok: true, events: clean };
}

// Two independent locks: the database flag AND an id held only in a Vercel
// environment variable. Either alone is not enough.
export function isAnalyticsAdmin({ userId, isAdminFlag, allowedUserId }) {
  return (
    typeof userId === 'string' && userId.length > 0 &&
    isAdminFlag === true &&
    typeof allowedUserId === 'string' && allowedUserId.length > 0 &&
    userId === allowedUserId
  );
}

// Returns the user on success, or null. Every failure is the same null so a
// caller can respond identically and reveal nothing about which lock failed.
// Used by the reporting sub-project; built and tested here so the rule exists
// before any data does.
export async function verifyAnalyticsAdmin(supabase, req, verifyUser, env = process.env) {
  const user = await verifyUser(supabase, req);
  if (!user) return null;
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single();
  const allowed = isAnalyticsAdmin({
    userId: user.id,
    isAdminFlag: profile?.is_admin,
    allowedUserId: env.ANALYTICS_ADMIN_USER_ID,
  });
  return allowed ? user : null;
}

export async function handleConsent(supabase, user, body) {
  if (!body || typeof body.enabled !== 'boolean') {
    return { status: 400, body: { error: 'enabled must be true or false' } };
  }
  let data, error;
  try {
    ({ data, error } = await supabase.rpc('scout_analytics_set_consent', {
      p_user_id: user.id,
      p_enabled: body.enabled,
      p_policy_version: ANALYTICS_POLICY_VERSION,
    }));
  } catch {
    console.error('[Scout] analytics consent failed: exception');
    return { status: 500, body: { error: 'Could not update your setting. Please try again.' } };
  }
  if (!error && data && data.ok === false && data.error === 'too_soon') {
    const when = typeof data.retry_after === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.retry_after) ? data.retry_after : null;
    return { status: 429, body: { error: when
      ? `You turned this off recently. You can turn it back on after ${when}.`
      : 'You turned this off recently. Please try again later.' } };
  }
  if (error || !data || data.ok !== true) {
    if (error) console.error('[Scout] analytics consent failed:', error.code || 'unknown');
    return { status: 500, body: { error: 'Could not update your setting. Please try again.' } };
  }
  return { status: 200, body: { consent: data.consent, bonusGranted: !!data.bonus_granted } };
}

export async function handleTrack(supabase, user, body) {
  const v = validateEvents(body?.events);
  if (!v.ok) return { status: 400, body: { error: v.error } };

  let data, error;
  try {
    ({ data, error } = await supabase.rpc('scout_analytics_ingest', {
      p_user_id: user.id,
      p_events: v.events,
    }));
  } catch {
    console.error('[Scout] analytics ingest failed: exception');
    return { status: 500, body: { error: 'Could not record events.' } };
  }
  if (error) {
    console.error('[Scout] analytics ingest failed:', error.code || 'unknown');
    return { status: 500, body: { error: 'Could not record events.' } };
  }
  return { status: 200, body: { stored: typeof data === 'number' ? data : 0 } };
}
