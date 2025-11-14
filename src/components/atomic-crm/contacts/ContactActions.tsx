import { MessageCircle, Phone } from "lucide-react";
import {
  useDataProvider,
  useGetIdentity,
  useNotify,
  useRecordContext,
} from "ra-core";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { supabase } from "../providers/supabase/supabase";
import type { Contact, PhoneNumberAndType } from "../types";
import { formatForDisplay, toE164 } from "../lib/phone";

const MIN_MESSAGE_LENGTH = 1;

export const ContactActions = () => {
  const record = useRecordContext<Contact>();
  const { identity } = useGetIdentity();
  const notify = useNotify();
  const dataProvider = useDataProvider();
  const [isSmsOpen, setIsSmsOpen] = useState(false);
  const [selectedPhone, setSelectedPhone] = useState<string>();
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);

  const phones = useMemo(
    () =>
      (record?.phone_jsonb as PhoneNumberAndType[] | undefined)?.filter(
        (entry) => !!entry?.number,
      ) ?? [],
    [record?.phone_jsonb],
  );

  const fallbackPhone = record?.phone_jsonb?.[0]?.number ?? "";
  const beetextingEmail =
    (identity as any)?.beetexting_agent_email || (identity as any)?.email;
  const smsEnabled = Boolean(beetextingEmail);

  if (!record) {
    return null;
  }

  const normalizedSelection =
    selectedPhone ??
    phones.find((phone) => phone.type === "Work")?.number ??
    phones[0]?.number ??
    fallbackPhone;

  const startCall = async () => {
    if (!normalizedSelection) {
      notify("No phone number available for this contact", { type: "warning" });
      return;
    }

    const dialable = toE164(normalizedSelection) ?? normalizedSelection;
    const payload = { type: "rc-call", phoneNumber: dialable };
    try {
      const iframe = document.getElementById(
        "rc-widget-sidebar",
      ) as HTMLIFrameElement | null;
      iframe?.contentWindow?.postMessage(payload, "*");
      window.postMessage(payload, "*");
      if (!iframe?.contentWindow) {
        window.location.href = `tel:${dialable}`;
      }
    } catch {
      window.location.href = `tel:${dialable}`;
    }

    if (!identity?.id) return;
    try {
      await dataProvider.create("contactNotes", {
        data: {
          contact_id: record.id,
          text: `[Call outbound] Dialed ${dialable}`,
          sales_id: identity.id,
          status: "sent",
        },
      });
    } catch (error) {
      console.error("log call note error", error);
    }
  };

  const sendSms = async () => {
    if (!normalizedSelection) {
      notify("No phone number available for this contact", { type: "warning" });
      return;
    }
    if (!smsEnabled || !beetextingEmail) {
      notify("Set your Beetexting agent email on your profile to send SMS.", {
        type: "warning",
      });
      return;
    }
    if (message.trim().length < MIN_MESSAGE_LENGTH) {
      notify("Please type a message", { type: "warning" });
      return;
    }

    setIsSending(true);
    try {
      const { error } = await supabase.functions.invoke("beetexting-send-sms", {
        method: "POST",
        body: {
          to: normalizedSelection,
          text: message.trim(),
          contactId: record.id,
          agentEmail: beetextingEmail,
          salesId: identity?.id,
        },
      });

      if (error) {
        throw new Error(error.message);
      }

      notify("SMS sent via Beetexting", { type: "info" });
      setIsSmsOpen(false);
      setMessage("");
    } catch (error) {
      console.error("sendSms.error", error);
      notify(
        error instanceof Error ? error.message : "Failed to send SMS",
        { type: "error" },
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="outline"
        className="justify-start gap-2"
        disabled={!normalizedSelection}
        onClick={startCall}
      >
        <Phone className="h-4 w-4" />
        Call
      </Button>

      <Dialog open={isSmsOpen} onOpenChange={setIsSmsOpen}>
        <DialogTrigger asChild>
          <Button
            variant="secondary"
            className="justify-start gap-2"
            title={
              smsEnabled
                ? undefined
                : "Add your Beetexting agent email in Settings → Sales"
            }
            disabled={(!phones.length && !fallbackPhone) || !smsEnabled}
          >
            <MessageCircle className="h-4 w-4" />
            Send SMS
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send SMS</DialogTitle>
            <DialogDescription>
              Message this contact via Beetexting. All messages are stored in the
              notes timeline.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Select
              value={normalizedSelection}
              onValueChange={setSelectedPhone}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select phone number" />
              </SelectTrigger>
              <SelectContent>
                {phones.map((phone) => (
                  <SelectItem key={phone.number} value={phone.number}>
                    {formatForDisplay(phone.number)}{" "}
                    {phone.type ? `(${phone.type})` : ""}
                  </SelectItem>
                ))}
                {!phones.length && fallbackPhone ? (
                  <SelectItem value={fallbackPhone}>{fallbackPhone}</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
            <Textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Type your message..."
              rows={5}
            />
          </div>
          <DialogFooter>
            <Button
              onClick={sendSms}
              disabled={isSending || !message.trim()}
            >
              {isSending ? "Sending..." : "Send message"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

