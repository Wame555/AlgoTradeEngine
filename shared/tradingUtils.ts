export interface SymbolFilters {
  stepSize?: number | null;
  minQty?: number | null;
  minNotional?: number | null;
}

export interface QuantityResult {
  quantity: number;
  notional: number;
}

export class QuantityValidationError extends Error {
  constructor(public readonly reason: 'PRICE' | 'MIN_QTY' | 'MIN_NOTIONAL' | 'STEP', message: string) {
    super(message);
    this.name = 'QuantityValidationError';
  }
}

function precisionFromStep(step: number): number {
  const stepString = step.toString();
  if (!stepString.includes('.')) {
    return 0;
  }
  return stepString.split('.')[1]?.length ?? 0;
}

function roundDownToStep(value: number, step: number): number {
  if (step <= 0) {
    throw new QuantityValidationError('STEP', 'Step size must be greater than zero');
  }
  const precision = precisionFromStep(step);
  const steps = Math.floor(value / step + Number.EPSILON);
  const rounded = steps * step;
  return Number(rounded.toFixed(precision));
}

export function calculateQuantityFromUsd(amountUsd: number, price: number, filters: SymbolFilters): QuantityResult {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw new QuantityValidationError('PRICE', 'Trade amount must be greater than zero');
  }
  if (!Number.isFinite(price) || price <= 0) {
    throw new QuantityValidationError('PRICE', 'Unable to determine valid market price');
  }

  const rawQty = amountUsd / price;
  let quantity = rawQty;

  const stepSize = filters.stepSize ?? undefined;
  if (stepSize && stepSize > 0) {
    quantity = roundDownToStep(rawQty, stepSize);
  }

  if (quantity <= 0) {
    throw new QuantityValidationError('STEP', 'Calculated quantity is zero after applying step size');
  }

  const minQty = filters.minQty ?? undefined;
  if (minQty && quantity + Number.EPSILON < minQty) {
    throw new QuantityValidationError('MIN_QTY', `Quantity must be at least ${minQty}`);
  }

  const notional = quantity * price;
  const minNotional = filters.minNotional ?? undefined;
  if (minNotional && notional + Number.EPSILON < minNotional) {
    throw new QuantityValidationError('MIN_NOTIONAL', `Notional must be at least ${minNotional}`);
  }

  return { quantity, notional };
}
