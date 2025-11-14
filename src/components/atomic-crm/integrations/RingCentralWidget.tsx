import { useEffect, useMemo } from "react";

const clientId = import.meta.env.VITE_RINGCENTRAL_CLIENT_ID;
const appServer =
  import.meta.env.VITE_RINGCENTRAL_APP_SERVER ?? "https://platform.ringcentral.com";
const appUrl =
  import.meta.env.VITE_RINGCENTRAL_APP_URL ??
  "https://apps.ringcentral.com/integration/ringcentral-embeddable/latest/app.html";
const adapterUrl =
  import.meta.env.VITE_RINGCENTRAL_ADAPTER_URL ??
  "https://apps.ringcentral.com/integration/ringcentral-embeddable/latest/adapter.js";
const defaultTab =
  import.meta.env.VITE_RINGCENTRAL_DEFAULT_TAB ?? "messages";

export const RingCentralWidget = () => {
  const enabled = Boolean(clientId);

  const queryString = useMemo(() => {
    if (!enabled) return "";
    const fallbackRedirect =
      typeof window === "undefined"
        ? undefined
        : `${window.location.origin}/auth-callback.html`;
    const redirectUri =
      import.meta.env.VITE_RINGCENTRAL_REDIRECT_URI ?? fallbackRedirect ?? "";

    const params = new URLSearchParams({
      clientId: clientId!,
      appServer,
      defaultTab,
      redirectUri,
      theme: "dark",
      disableConferences: "true",
    });
    return params.toString();
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof document === "undefined" || typeof window === "undefined") {
      return;
    }
    if (document.getElementById("ringcentral-embeddable-script")) return;

    (window as any).RingCentralEmbeddable = {
      config: {
        defaultTab,
        theme: "dark",
      },
    };

    const script = document.createElement("script");
    script.id = "ringcentral-embeddable-script";
    script.async = true;
    script.src = `${adapterUrl}?${queryString}`;
    document.body.appendChild(script);

    return () => {
      script.remove();
    };
  }, [enabled, queryString]);

  if (!enabled) return null;

  return (
    <div className="hidden lg:block fixed bottom-6 right-6 w-80 h-[520px] rounded-xl border border-slate-800 shadow-2xl overflow-hidden backdrop-blur">
      <iframe
        title="RingCentral communications"
        src={`${appUrl}?${queryString}`}
        allow="microphone; camera; autoplay; clipboard-write"
        className="h-full w-full bg-[#0f172a]"
      />
    </div>
  );
};

