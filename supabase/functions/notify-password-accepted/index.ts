// Supabase Edge Function: emails the student after a Teacher accepts a password request.
// Secrets needed (Supabase -> Edge Functions -> Secrets):
//   BREVO_API_KEY  (Brevo -> SMTP & API -> API Keys)    BREVO_SENDER (your verified Brevo sender email)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const { id } = await req.json();
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    // RLS: only the chosen teacher or the admin can read this row
    const { data, error } = await sb.from("password_requests").select("username,email,status,decided_at").eq("id", id).single();
    if (error || !data || data.status !== "accepted") return new Response(JSON.stringify({ error: "not allowed" }), { status: 403, headers: cors });
    if (Date.now() - new Date(data.decided_at).getTime() > 10 * 60 * 1000) return new Response(JSON.stringify({ error: "too old" }), { status: 400, headers: cors });

    const when = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "long", timeStyle: "short" });
    const html = `<p>Hi, <b>${data.username}</b></p><p>Your request to change your password has been accepted. You can now log in with the new password you chose.</p><p>Thank you for your request.</p><p style="color:#666">Date: ${when}</p>`;
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": Deno.env.get("BREVO_API_KEY")!, "content-type": "application/json" },
      body: JSON.stringify({ sender: { name: "WB-T&C", email: Deno.env.get("BREVO_SENDER") }, to: [{ email: data.email }], subject: "Your password change was accepted", htmlContent: html }),
    });
    if (!r.ok) return new Response(JSON.stringify({ error: "email failed" }), { status: 502, headers: cors });
    return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
