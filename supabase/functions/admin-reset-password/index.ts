import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");

    const { user_id, new_password } = await req.json();
    if (!user_id || !new_password || String(new_password).length < 6) {
      throw new Error("user_id dan new_password (min 6 karakter) wajib diisi");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    // Client pakai JWT pemanggil, untuk verifikasi identitas + role lewat RLS
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerData, error: callerErr } =
      await callerClient.auth.getUser();
    if (callerErr || !callerData.user) throw new Error("Sesi tidak valid");

    const { data: profile, error: profErr } = await callerClient
      .from("profiles")
      .select("role")
      .eq("id", callerData.user.id)
      .single();
    if (profErr || !profile || profile.role !== "admin") {
      throw new Error("Hanya admin yang boleh mengubah password user lain");
    }

    // Service role key hanya dipakai setelah pemanggil terverifikasi admin
    const adminClient = createClient(supabaseUrl, serviceKey);
    const { error: resetErr } = await adminClient.auth.admin.updateUserById(
      user_id,
      { password: new_password },
    );
    if (resetErr) throw resetErr;

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
