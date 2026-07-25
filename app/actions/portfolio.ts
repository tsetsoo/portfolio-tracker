"use server";

import { revalidatePath } from "next/cache";

import { getDb } from "@/lib/db/client";
import type { Holding, Lot } from "@/lib/domain/types";
import {
  addLot as addLotToRepo,
  createHolding as createHoldingInRepo,
  deleteHolding as deleteHoldingFromRepo,
  updateManualValue as updateManualValueInRepo,
} from "@/lib/holdings-repo";
import type {
  CreateHoldingInput,
  CreateLotInput,
} from "@/lib/holdings-repo";

export async function createHolding(
  input: CreateHoldingInput,
): Promise<Holding> {
  const holding = createHoldingInRepo(getDb(), input);
  revalidatePath("/");
  return holding;
}

export async function addLot(
  holdingId: string,
  input: CreateLotInput,
): Promise<Lot> {
  const lot = addLotToRepo(getDb(), holdingId, input);
  revalidatePath("/");
  return lot;
}

export async function updateManualValue(
  holdingId: string,
  value: number,
): Promise<Holding> {
  const holding = updateManualValueInRepo(getDb(), holdingId, value);
  revalidatePath("/");
  return holding;
}

export async function deleteHolding(holdingId: string): Promise<void> {
  deleteHoldingFromRepo(getDb(), holdingId);
  revalidatePath("/");
}
