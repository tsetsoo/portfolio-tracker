"use client";

import { addCryptoHolding, addManualHolding } from "@/app/actions/portfolio";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { SectionHeading } from "@/components/ui/SectionHeading";

export function HoldingForm({
  onMutated,
}: {
  onMutated?: () => void;
} = {}) {
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <Card as="div" className="content-start">
        <SectionHeading eyebrow="Market priced" title="Add crypto" />
        <form
          action={async (formData) => {
            await addCryptoHolding(formData);
            onMutated?.();
          }}
          className="grid gap-3.5 p-5"
        >
          <Field label="Symbol">
            <input
              name="symbol"
              placeholder="BTC"
              required
              autoCapitalize="characters"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity">
              <input
                name="quantity"
                type="number"
                min="0.00000001"
                step="any"
                required
              />
            </Field>
            <Field label="Cost / unit">
              <input
                name="costPerUnit"
                type="number"
                min="0.00000001"
                step="any"
                required
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Currency" className="[&_input]:uppercase">
              <input
                name="costCurrency"
                defaultValue="EUR"
                maxLength={3}
                pattern="[A-Za-z]{3}"
                required
              />
            </Field>
            <Field label="Purchase date">
              <input
                name="purchasedAt"
                type="date"
                defaultValue={today}
                required
              />
            </Field>
          </div>
          <Button variant="primary" type="submit" className="justify-self-start">
            Add crypto lot
          </Button>
        </form>
      </Card>

      <Card as="div" className="content-start">
        <SectionHeading eyebrow="Entered by you" title="Add manual asset" />
        <form
          action={async (formData) => {
            await addManualHolding(formData);
            onMutated?.();
          }}
          className="grid gap-3.5 p-5"
        >
          <Field label="Name">
            <input name="name" placeholder="Savings account" required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Current value">
              <input
                name="manualValue"
                type="number"
                min="0.00000001"
                step="any"
                required
              />
            </Field>
            <Field label="Currency" className="[&_input]:uppercase">
              <input
                name="currency"
                defaultValue="EUR"
                maxLength={3}
                pattern="[A-Za-z]{3}"
                required
              />
            </Field>
          </div>
          <p className="text-[11px] text-dim">
            Manual assets use the value you enter until you update them.
          </p>
          <Button variant="primary" type="submit" className="justify-self-start">
            Add manual asset
          </Button>
        </form>
      </Card>
    </div>
  );
}
