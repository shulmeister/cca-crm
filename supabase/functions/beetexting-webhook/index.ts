import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { normalizePhoneNumber } from "../_shared/phone.ts";

const WEBHOOK_SECRET = Deno.env.get("BEETEXTING_WEBHOOK_SECRET");

type BeetextingWebhookPayload = {
  event?: string;
  agentEmail?: string;
  payload?: Record<string, unknown>;
  contact?: Record<string, unknown>;
  text?: string;
  message?: string;
  direction?: string;
  from?: string;
  to?: string;
};

const textFromPayload = (payload: Record<string, unknown>) => {
  const candidates = [
    payload.text,
    payload.message,
    payload.body,
    payload.content,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length) {
      return candidate.trim();
    }
  }
  return JSON.stringify(payload);
};

const extractPhone = (payload: Record<string, unknown>, key: string) => {
  const raw = payload[key];
  if (typeof raw === "string") return normalizePhoneNumber(raw);
  if (typeof raw === "object" && raw !== null) {
    const inner = (raw as Record<string, unknown>).phoneNumber;
    if (typeof inner === "string") {
      return normalizePhoneNumber(inner);
    }
  }
  return undefined;
};

const findOrCreateContact = async (
  phone: string,
  displayName?: string,
  salesEmail?: string,
) => {
  const { data: existingContact } = await supabaseAdmin
    .rpc("find_contact_by_phone", { p_phone: phone })
    .maybeSingle();

  if (existingContact) {
    return existingContact;
  }

  let salesId: number | null = null;
  if (salesEmail) {
    const { data: byAgent } = await supabaseAdmin
      .from("sales")
      .select("id")
      .eq("beetexting_agent_email", salesEmail)
      .maybeSingle();
    if (byAgent?.id) {
      salesId = byAgent.id;
    } else {
      const { data: byEmail } = await supabaseAdmin
        .from("sales")
        .select("id")
        .eq("email", salesEmail)
        .maybeSingle();
      salesId = byEmail?.id ?? null;
    }
  }

  const [firstName = "SMS", lastName = "Lead"] = (displayName ?? "")
    .split(" ")
    .filter(Boolean);

  const { data: inserted } = await supabaseAdmin
    .from("contacts")
    .insert({
      first_name: firstName,
      last_name: lastName,
      phone_jsonb: [{ number: phone, type: "Mobile" }],
      first_seen: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      sales_id: salesId ?? undefined,
    })
    .select()
    .maybeSingle();

  if (!inserted) {
    throw new Error("Unable to create fallback contact");
  }

  return inserted;
};

const logInboundSms = async (
  contactId: number,
  salesId: number | null,
  text: string,
  direction: string,
  fromNumber?: string,
  toNumber?: string,
) => {
  const prefix = direction === "outbound" ? "SMS outbound" : "SMS inbound";
  const detail = [fromNumber && `From ${fromNumber}`, toNumber && `To ${toNumber}`]
    .filter(Boolean)
    .join(" • ");

  await supabaseAdmin.from("contactNotes").insert({
    contact_id: contactId,
    sales_id: salesId ?? undefined,
    text: detail ? `[${prefix}] ${detail} — ${text}` : `[${prefix}] ${text}`,
    status: direction === "outbound" ? "sent" : "received",
  });

  await supabaseAdmin
    .from("contacts")
    .update({ last_seen: new Date().toISOString() })
    .eq("id", contactId);
};

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    if (WEBHOOK_SECRET) {
      const provided = req.headers.get("x-api-key");
      if (!provided || provided !== WEBHOOK_SECRET) {
        return new Response("Unauthorized", { status: 401 });
      }
    }

    const event = (await req.json()) as BeetextingWebhookPayload;
    const payload =
      typeof event.payload === "object" && event.payload !== null
        ? event.payload
        : event;

    const direction =
      (typeof payload.direction === "string" && payload.direction.toLowerCase()) ||
      (event.event?.includes("direction=outbound") ? "outbound" : "inbound");

    const fromNumber =
      extractPhone(payload as Record<string, unknown>, "from") ??
      extractPhone(payload as Record<string, unknown>, "fromNumber") ??
      extractPhone(payload as Record<string, unknown>, "mobileNumber");

    const toNumber =
      extractPhone(payload as Record<string, unknown>, "to") ??
      extractPhone(payload as Record<string, unknown>, "toNumber");

    if (!fromNumber && !toNumber) {
      return new Response("Missing phone details", { status: 400 });
    }

    const normalizedKey = direction === "outbound" ? toNumber : fromNumber;
    if (!normalizedKey) {
      return new Response("Unable to resolve phone identity", { status: 400 });
    }

    const displayName =
      (payload.contactName as string | undefined) ??
      (payload.firstName as string | undefined);
    const contact = await findOrCreateContact(
      normalizedKey,
      displayName,
      event.agentEmail,
    );

    const messageText = textFromPayload(payload as Record<string, unknown>);

    await logInboundSms(
      contact.id,
      contact.sales_id ?? null,
      messageText,
      direction,
      fromNumber,
      toNumber,
    );

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("beetexting-webhook.error", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }),
      { headers: { "Content-Type": "application/json" }, status: 500 },
    );
  }
});

