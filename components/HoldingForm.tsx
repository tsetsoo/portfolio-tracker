import {
  addCryptoHolding,
  addManualHolding,
} from "@/app/actions/portfolio";

export function HoldingForm() {
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="holding-forms">
      <form action={addCryptoHolding} className="asset-form">
        <div className="form-heading">
          <p className="eyebrow">Market priced</p>
          <h2>Add crypto</h2>
        </div>
        <label>
          Symbol
          <input
            name="symbol"
            placeholder="BTC"
            required
            autoCapitalize="characters"
          />
        </label>
        <div className="form-pair">
          <label>
            Quantity
            <input name="quantity" type="number" min="0" step="any" required />
          </label>
          <label>
            Cost / unit
            <input
              name="costPerUnit"
              type="number"
              min="0"
              step="any"
              required
            />
          </label>
        </div>
        <div className="form-pair">
          <label>
            Currency
            <input
              className="currency-input"
              name="costCurrency"
              defaultValue="EUR"
              maxLength={3}
              pattern="[A-Za-z]{3}"
              required
            />
          </label>
          <label>
            Purchase date
            <input name="purchasedAt" type="date" defaultValue={today} required />
          </label>
        </div>
        <button className="primary-button" type="submit">
          Add crypto lot
        </button>
      </form>

      <form action={addManualHolding} className="asset-form">
        <div className="form-heading">
          <p className="eyebrow">Entered by you</p>
          <h2>Add manual asset</h2>
        </div>
        <label>
          Name
          <input name="name" placeholder="Savings account" required />
        </label>
        <div className="form-pair">
          <label>
            Current value
            <input
              name="manualValue"
              type="number"
              min="0"
              step="any"
              required
            />
          </label>
          <label>
            Currency
            <input
              className="currency-input"
              name="currency"
              defaultValue="EUR"
              maxLength={3}
              pattern="[A-Za-z]{3}"
              required
            />
          </label>
        </div>
        <p className="form-note">
          Manual assets use the value you enter until you update them.
        </p>
        <button className="primary-button" type="submit">
          Add manual asset
        </button>
      </form>
    </div>
  );
}
