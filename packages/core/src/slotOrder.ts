import { COMMANDS, COMMANDS_BY_ID } from './catalog';
import { PREFIX_BIGOPS } from './commandSpecs';
import type { AppSettings, SlotOrderOverrides, SlotOrderPreset } from './types';

const DERIVED_BIGOP_IDS: readonly string[] = COMMANDS.filter(
  (c) => PREFIX_BIGOPS.has(c.id) && c.slots.length === 3 && c.id !== 'limit',
).map((c) => c.id);

export interface SlotOrderOption {
  readonly label: string;
  readonly order: readonly number[];
}

export interface SlotOrderGroup {
  readonly id: string;
  readonly label: string;
  readonly commandIds: readonly string[];
  readonly options: readonly SlotOrderOption[];
}

export const SLOT_ORDER_GROUPS: readonly SlotOrderGroup[] = [
  {
    id: 'fraction',
    label: '分数',
    commandIds: ['frac', 'partial_frac', 'total_frac'],
    options: [
      { label: '分子 → 分母', order: [0, 1] },
      { label: '分母 → 分子', order: [1, 0] },
    ],
  },
  {
    id: 'sqrt',
    label: '根号',
    commandIds: ['sqrt', 'nth_root'],
    options: [
      { label: '被开方式 → 根指数', order: [1, 0] },
      { label: '根指数 → 被开方式', order: [0, 1] },
    ],
  },
  {
    id: 'bigop',
    label: '积分 / 求和 / 并交',
    commandIds: DERIVED_BIGOP_IDS,
    options: [
      { label: '下限 → 上限 → 主体', order: [0, 1, 2] },
      { label: '上限 → 下限 → 主体', order: [1, 0, 2] },
      { label: '主体 → 下限 → 上限', order: [2, 0, 1] },
    ],
  },
  {
    id: 'nth_deriv',
    label: '高阶导数 / 偏导',
    commandIds: ['nth_partial', 'nth_deriv'],
    options: [
      { label: '阶数 → 分子 → 变量 → 分母阶数', order: [0, 1, 2, 3] },
      { label: '分子 → 变量 → 阶数 → 分母阶数', order: [1, 2, 0, 3] },
    ],
  },
  {
    id: 'limit',
    label: '极限',
    commandIds: ['limit'],
    options: [
      { label: '变量 → 目标 → 主体', order: [0, 1, 2] },
      { label: '主体 → 变量 → 目标', order: [2, 0, 1] },
    ],
  },
  {
    id: 'subsup',
    label: '上下标',
    commandIds: ['subsup'],
    options: [
      { label: '主体 → 下标 → 上标', order: [0, 1, 2] },
      { label: '主体 → 上标 → 下标', order: [0, 2, 1] },
    ],
  },
  {
    id: 'binom',
    label: '二项式',
    commandIds: ['binom'],
    options: [
      { label: '上标 → 下标', order: [0, 1] },
      { label: '下标 → 上标', order: [1, 0] },
    ],
  },
];

const STANDARD_DEFAULT_ORDERS: Readonly<Record<string, readonly number[]>> = {
  // Unified root & differential start in main variable slot; Enter hops to optional index/order!
  sqrt: [1, 0],
  diff: [1, 0],
  xrightarrow: [1, 0],
  xleftarrow: [1, 0],
};

const WRITING_CN_ORDERS: Readonly<Record<string, readonly number[]>> = {
  frac: [1, 0],
  partial_frac: [1, 0],
  total_frac: [1, 0],
  sqrt: [1, 0],
  nth_root: [1, 0],
  diff: [1, 0],
  binom: [1, 0],
  xrightarrow: [1, 0],
  xleftarrow: [1, 0],
};

function isValidPermutation(order: readonly number[] | undefined, slotCount: number): boolean {
  if (!order || order.length !== slotCount) return false;
  const seen = new Set<number>();
  for (const idx of order) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= slotCount || seen.has(idx)) {
      return false;
    }
    seen.add(idx);
  }
  return true;
}

export function getPresetOrderForCommand(
  commandId: string,
  preset: SlotOrderPreset,
  slotCount: number,
): number[] {
  if (preset === 'writing_cn') {
    const custom = WRITING_CN_ORDERS[commandId];
    if (isValidPermutation(custom, slotCount)) {
      return [...custom];
    }
  } else {
    const std = STANDARD_DEFAULT_ORDERS[commandId];
    if (isValidPermutation(std, slotCount)) {
      return [...std];
    }
  }
  return Array.from({ length: slotCount }, (_, i) => i);
}

export function getSlotOrder(
  commandId: string,
  settings: Pick<AppSettings, 'slotOrderPreset' | 'slotOrderOverrides'>,
  slotCountOverride?: number,
): number[] {
  const slotCount = slotCountOverride ?? COMMANDS_BY_ID.get(commandId)?.slots.length ?? 0;
  if (slotCount <= 1) {
    return Array.from({ length: slotCount }, (_, i) => i);
  }
  const override = settings.slotOrderOverrides?.[commandId];
  if (isValidPermutation(override, slotCount)) {
    return [...override];
  }
  return getPresetOrderForCommand(commandId, settings.slotOrderPreset ?? 'standard', slotCount);
}

export function applyGroupSlotOrder(
  overrides: SlotOrderOverrides,
  group: SlotOrderGroup,
  order: readonly number[],
): SlotOrderOverrides {
  const next: SlotOrderOverrides = { ...overrides };
  for (const cmdId of group.commandIds) {
    next[cmdId] = [...order];
  }
  return next;
}
