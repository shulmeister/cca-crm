import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { normalizePhoneNumber } from "../_shared/phone.ts";

const CLIENT_ID = Deno.env.get("BEETEXTING_CLIENT_ID");
const CLIENT_SECRET = Deno.env.get("BEETEXTING_CLIENT_SECRET");
const API_KEY = Deno.env.get("BEETEXTING_API_KEY");
const FROM_NUMBER = Deno.env.get("BEETEXTING_FROM_NUMBER");
const BASE_URL =
  Deno.env.get("BEETEXTING_API_URL") ?? "https://connect.beetexting.com/prod";
const TOKEN_URL =
  Deno.env.get("BEETEXTING_AUTH_URL") ?? "https://auth.beetexting.com/oauth2/token/";

type SendSmsPayload = {
  agentEmail?: string;
  contactId?: number;
  to: string;
  text: string;
};

type BeetextingTokenResponse = {
  access_token: string;
  expires_in?: number;
};

const tokenCache: { token?: string; expiresAt?: number } = {};

const ensureEnv = () => {
  if (!CLIENT_ID || !CLIENT_SECRET || !API_KEY || !FROM_NUMBER) {
    throw new Error(
      "Missing Beetexting configuration. Please set BEETEXTING_CLIENT_ID, BEETEXTING_CLIENT_SECRET, BEETEXTING_API_KEY and BEETEXTING_FROM_NUMBER.",
    );
  }
};

const getAccessToken = async () => {
  if (
    tokenCache.token &&
    tokenCache.expiresAt &&
    tokenCache.expiresAt > Date.now()
  ) {
    return tokenCache.token;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID!,
    client_secret: CLIENT_SECRET!,
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "x-api-key": API_KEY!,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Beetexting auth failed (${response.status}): ${errorText}`,
    );
  }

  const token: BeetextingTokenResponse = await response.json();
  tokenCache.token = token.access_token;
  tokenCache.expiresAt = Date.now() + ((token.expires_in ?? 300) - 30) * 1000;
  return token.access_token;
};

const logContactNote = async (
  contactId: number,
  text: string,
  salesEmail?: string,
) => {
  if (!contactId) return;
  let salesId: number | null = null;
  if (salesEmail) {
    const { data } = await supabaseAdmin
      .from("sales")
      .select("id")
      .eq("email", salesEmail)
      .maybeSingle();
    salesId = data?.id ?? null;
  }

  await supabaseAdmin.from("contactNotes").insert({
    contact_id: contactId,
    text,
    sales_id: salesId ?? undefined,
    status: "sent",
  });

  await supabaseAdmin
    .from("contacts")
    .update({ last_seen: new Date().toISOString() })
    .eq("id", contactId);
};

Deno.serve(async (req) => {
  try {
    ensureEnv();

    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const payload = (await req.json()) as SendSmsPayload;

    if (!payload?.to || !payload?.text) {
      return new Response("Missing to/text", { status: 400 });
    }

    const normalizedTo = normalizePhoneNumber(payload.to);
    const normalizedFrom = normalizePhoneNumber(FROM_NUMBER);

    if (!normalizedTo || !normalizedFrom) {
      return new Response("Invalid phone number format", { status: 400 });
    }

    const accessToken = await getAccessToken();

    const params = new URLSearchParams({
      from: normalizedFrom,
      to: normalizedTo,
      text: payload.text,
    });

    const path = payload.agentEmail
      ? `/message/sendsms/${encodeURIComponent(payload.agentEmail)}`
      : "/message/sendsms";

    const response = await fetch(`${BASE_URL}${path}?${params.toString()}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "x-api-key": API_KEY!,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return new Response(errorBody, { status: response.status });
    }

    if (payload.contactId) {
      await logContactNote(
        payload.contactId,
        `[SMS outbound] ${payload.text}`,
        payload.agentEmail,
      );
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("beetexting-send-sms.error", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }),
      { headers: { "Content-Type": "application/json" }, status: 500 },
    );
  }
});

