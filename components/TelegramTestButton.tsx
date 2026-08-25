"use client";

import { useState, useTransition } from "react";

import { sendTestMessageAction } from "@/app/actions/alerts";
import { Button } from "@/components/ui/Button";

export function TelegramTestButton({ configured }: { configured: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="grid gap-2 p-5">
      <div className="flex items-center gap-2">
        <Button
          disabled={!configured || isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await sendTestMessageAction();
              setMessage(result.ok ? "Sent." : result.error);
            })
          }
        >
          Send test message
        </Button>
        {message && <span className="text-[11px] text-dim">{message}</span>}
      </div>
      {!configured && (
        <p className="text-[11px] leading-relaxed text-faint">
          Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID and restart the app to
          enable alert delivery.
        </p>
      )}
    </div>
  );
}
