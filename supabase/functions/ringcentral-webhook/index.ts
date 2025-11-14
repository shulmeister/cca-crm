import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { normalizePhoneNumber } from "../_shared/phone.ts";

const WEBHOOK_TOKEN = Deno.env.get("RINGCENTRAL_WEBHOOK_TOKEN");

type Party = {
  direction?: string;
  extensionId?: string | number;
  from?: { phoneNumber?: string; extensionNumber?: string };
  to?: { phoneNumber?: string; extensionNumber?: string };
  status?: { code?: string; reason?: string };
  result?: string;
  startTime?: string;
};

const responseSuccess = () =>
  new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" },
  });

const findContactByPhone = async (phone?: string | null) => {
  if (!phone) return null;
  const normalized = normalizePhoneNumber(phone);
  if (!normalized) return null;
  const { data } = await supabaseAdmin
    .rpc("find_contact_by_phone", { p_phone: normalized })
    .maybeSingle();
  return data ?? null;
};

const findSalesIdByExtension = async (extension?: string | number) => {
  if (!extension && extension !== 0) return null;
  const extString = String(extension);
  const { data } = await supabaseAdmin
    .from("sales")
    .select("id")
    .eq("ringcentral_extension", extString)
    .maybeSingle();
  return data?.id ?? null;
};

const logCall = async (params: {
  contactId: number;
  salesId: number | null;
  text: string;
  direction: string;
}) => {
  await supabaseAdmin.from("contactNotes").insert({
    contact_id: params.contactId,
    sales_id: params.salesId ?? undefined,
    text: params.text,
    status: params.direction === "outbound" ? "sent" : "received",
  });

  await supabaseAdmin
    .from("contacts")
    .update({ last_seen: new Date().toISOString() })
    .eq("id", params.contactId);
};

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }
    return new Response("Method Not Allowed", { status: 405 });
  }

  const validationToken = req.headers.get("validation-token");
  if (validationToken) {
    return new Response(null, {
      status: 200,
      headers: { "validation-token": validationToken },
    });
  }

  if (WEBHOOK_TOKEN) {
    const provided = new URL(req.url).searchParams.get("token");
    if (!provided || provided !== WEBHOOK_TOKEN) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  try {
    const payload = await req.json();
    const parties: Party[] = payload?.body?.parties ?? [];
    if (!Array.isArray(parties) || parties.length === 0) {
      return responseSuccess();
    }

    for (const party of parties) {
      const direction = (party.direction ?? "").toLowerCase();
      const fromNumber =
        party.from?.phoneNumber ??
        party.from?.extensionNumber ??
        undefined;
      const toNumber =
        party.to?.phoneNumber ?? party.to?.extensionNumber ?? undefined;

      const contactPhone =
        direction === "outbound"
          ? toNumber ?? fromNumber
          : fromNumber ?? toNumber;

      const contact = await findContactByPhone(contactPhone);
      if (!contact?.id) {
        continue;
      }

      const extensionId =
        typeof party.extensionId === "number" ||
        typeof party.extensionId === "string"
          ? party.extensionId
          : undefined;

      const saleId =
        (await findSalesIdByExtension(extensionId)) ?? contact.sales_id ?? null;

      const status = party.status?.code ?? party.result ?? "Unknown";
      const details = [
        direction ? `Call ${direction}` : "Call",
        status && `Status: ${status}`,
        fromNumber && toNumber
          ? `From ${normalizePhoneNumber(fromNumber) ?? fromNumber} → ${
              normalizePhoneNumber(toNumber) ?? toNumber
            }`
          : undefined,
      ]
        .filter(Boolean)
        .join(" • ");

      await logCall({
        contactId: contact.id,
        salesId: saleId,
        text: details,
        direction: direction === "outbound" ? "outbound" : "inbound",
      });
    }

    return responseSuccess();
  } catch (error) {
    console.error("ringcentral-webhook.error", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }),
      { headers: { "Content-Type": "application/json" }, status: 500 },
    );
  }
});

