import { saveBaseCurrency } from "@/app/actions/settings";
import { Button } from "@/components/ui/Button";
import { FIELD_CONTROL } from "@/components/ui/Field";

export function SettingsForm({ baseCurrency }: { baseCurrency: string }) {
  return (
    <form action={saveBaseCurrency} className={`grid gap-3 p-5 ${FIELD_CONTROL}`}>
      <div>
        <label htmlFor="base-currency" className="eyebrow">
          Base currency
        </label>
        <p className="mt-1.5 text-[11px] text-dim">
          Portfolio totals, performance, and snapshots are converted to this
          currency.
        </p>
      </div>

      <div className="flex items-stretch gap-2">
        <input
          id="base-currency"
          name="baseCurrency"
          defaultValue={baseCurrency.toUpperCase()}
          maxLength={3}
          minLength={3}
          pattern="[A-Za-z]{3}"
          required
          aria-describedby="currency-hint"
          className="max-w-32 uppercase"
        />
        <Button variant="primary" type="submit" className="shrink-0">
          Save changes
        </Button>
      </div>

      <small id="currency-hint" className="text-[11px] text-faint">
        Use a three-letter ISO code, such as EUR.
      </small>
    </form>
  );
}
