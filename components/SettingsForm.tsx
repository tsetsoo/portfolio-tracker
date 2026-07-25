import { saveBaseCurrency } from "@/app/actions/settings";

export function SettingsForm({
  baseCurrency,
}: {
  baseCurrency: string;
}) {
  return (
    <form action={saveBaseCurrency} className="settings-form">
      <label htmlFor="base-currency">Base currency</label>
      <p>
        Portfolio totals, performance, and snapshots are converted to this
        currency.
      </p>
      <div className="settings-control">
        <input
          className="currency-input"
          id="base-currency"
          name="baseCurrency"
          defaultValue={baseCurrency.toUpperCase()}
          maxLength={3}
          minLength={3}
          pattern="[A-Za-z]{3}"
          required
          aria-describedby="currency-hint"
        />
        <button className="primary-button" type="submit">
          Save changes
        </button>
      </div>
      <small id="currency-hint">Use a three-letter ISO code, such as EUR.</small>
    </form>
  );
}
