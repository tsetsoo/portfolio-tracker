import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/alerts", () => ({
  sendTestMessageAction: vi.fn(),
}));

import { TelegramTestButton } from "@/components/TelegramTestButton";

describe("TelegramTestButton", () => {
  it("offers a test send when configured", () => {
    const html = renderToStaticMarkup(<TelegramTestButton configured />);
    expect(html).toContain("Send test message");
    // Button's class list contains "disabled:opacity-45", so assert on the
    // rendered attribute, not the substring "disabled".
    expect(html).not.toContain('disabled=""');
  });

  it("disables itself and explains when not configured", () => {
    const html = renderToStaticMarkup(
      <TelegramTestButton configured={false} />,
    );
    expect(html).toContain('disabled=""');
    expect(html).toContain("TELEGRAM_BOT_TOKEN");
  });
});
