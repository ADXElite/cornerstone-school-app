// Sends a push notification to every device that turned on notifications in the Cornerstone app.
// Only signed-in school admins (public.admins) may call it.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await admin.auth.getUser(token);
  const email = u?.user?.email?.toLowerCase();
  const { data: isAdmin } = email ? await admin.from("admins").select("email").eq("email", email).maybeSingle() : { data: null };
  if (!isAdmin) return json({ error: "Only school admins can send notifications." }, 401);

  const body = await req.json().catch(() => ({}));
  const title = String(body.title || "").trim().slice(0, 80);
  const message = String(body.body || "").trim().slice(0, 300);
  const url = body.url ? String(body.url).trim().slice(0, 500) : null;
  if (!title) return json({ error: "Add a title for the notification." }, 400);

  const { data: cfg } = await admin.rpc("get_private_config");
  webpush.setVapidDetails(cfg.vapid_subject, cfg.vapid_public, cfg.vapid_private);

  const { data: note, error: nErr } = await admin.from("notifications")
    .insert({ title, body: message, url, sent_by: email }).select("id").single();
  if (nErr) return json({ error: nErr.message }, 500);

  const { data: subs, error: sErr } = await admin.from("push_subscriptions").select("endpoint,p256dh,auth");
  if (sErr) return json({ error: sErr.message }, 500);

  const payload = JSON.stringify({ title, body: message, url: url || "/", id: note.id, tag: `ccs-${note.id}` });
  let sent = 0, failed = 0;
  const gone: string[] = [];
  const okEndpoints: string[] = [];
  const queue = [...(subs || [])];
  const worker = async () => {
    while (queue.length) {
      const s = queue.shift()!;
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 24, urgency: "high" });
        sent++; okEndpoints.push(s.endpoint);
      } catch (e) {
        failed++;
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) gone.push(s.endpoint);
      }
    }
  };
  await Promise.all(Array.from({ length: 10 }, worker));

  if (gone.length) await admin.from("push_subscriptions").delete().in("endpoint", gone);
  if (okEndpoints.length) await admin.from("push_subscriptions").update({ last_ok_at: new Date().toISOString() }).in("endpoint", okEndpoints.slice(0, 1000));
  await admin.from("notifications").update({ sent_count: sent, failed_count: failed }).eq("id", note.id);

  return json({ ok: true, sent, failed, removed: gone.length, devices: subs?.length || 0 });
});
