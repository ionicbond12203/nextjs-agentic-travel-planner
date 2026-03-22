/**
 * 价格推理模块 (Price Inference Module)
 *
 * 解决问题：RAG检索结果需要与用户身份交叉推理
 * 例如：卢浮宫门票对欧盟公民€22，非欧盟游客€32
 */

import { isEEAUser, detectMalaysianUser } from './dialogue-state';

export interface PriceRule {
  /** 规则ID */
  id: string;
  /** 景点名称 */
  attraction: string;
  /** 适用条件 */
  condition: 'eea_resident' | 'non_eea' | 'student' | 'senior' | 'child' | 'all';
  /** 价格 */
  price: number;
  /** 货币 */
  currency: string;
  /** 时效性说明 */
  validity?: string;
}

/**
 * 已知的差别化定价规则
 * 数据来源：官方票价政策（2026年最新）
 */
export const KNOWN_PRICE_RULES: PriceRule[] = [
  // 卢浮宫 - 2026年1月新规
  {
    id: 'louvre_eea',
    attraction: '卢浮宫',
    condition: 'eea_resident',
    price: 22,
    currency: 'EUR',
    validity: '2026年1月14日起，欧洲经济区(EEA)公民优惠票价'
  },
  {
    id: 'louvre_non_eea',
    attraction: '卢浮宫',
    condition: 'non_eea',
    price: 32,
    currency: 'EUR',
    validity: '2026年1月14日起，非欧洲经济区游客标准票价'
  },
  // 凡尔赛宫
  {
    id: 'versailles_eea',
    attraction: '凡尔赛宫',
    condition: 'eea_resident',
    price: 22,
    currency: 'EUR',
    validity: '欧洲经济区公民优惠票'
  },
  {
    id: 'versailles_non_eea',
    attraction: '凡尔赛宫',
    condition: 'non_eea',
    price: 35,
    currency: 'EUR',
    validity: '非欧洲经济区游客标准票价'
  },
  // 奥赛博物馆
  {
    id: 'orsay_eea',
    attraction: '奥赛博物馆',
    condition: 'eea_resident',
    price: 14,
    currency: 'EUR',
  },
  {
    id: 'orsay_non_eea',
    attraction: '奥赛博物馆',
    condition: 'non_eea',
    price: 17,
    currency: 'EUR',
  },
  // 埃菲尔铁塔
  {
    id: 'eiffel_all',
    attraction: '埃菲尔铁塔',
    condition: 'all',
    price: 28,
    currency: 'EUR',
    validity: '电梯登顶标准票价'
  },
  {
    id: 'eiffel_stairs',
    attraction: '埃菲尔铁塔',
    condition: 'all',
    price: 20,
    currency: 'EUR',
    validity: '楼梯+电梯二层票价'
  },
];

/**
 * 常见问题票价映射
 */
export const COMMON_FAQS: Record<string, { question: string; answer: string }> = {
  louvre_price: {
    question: '卢浮宫门票价格',
    answer: `卢浮宫2026年票价（自1月14日起生效）：
• 欧洲经济区(EEA)公民：€22
• 非欧盟游客：€32（马来西亚游客适用此价格）
• 18岁以下免费
• 18-25岁EEA公民免费`
  },
  versailles_price: {
    question: '凡尔赛宫门票',
    answer: `凡尔赛宫票价：
• EEA公民：€22
• 非EEA游客：€35
• 每月第一个周日（11月-3月）免费`
  },
};

/**
 * 根据用户身份获取正确票价
 */
export function getCorrectPrice(
  attraction: string,
  userNationality: string | null,
  userOriginCity: string | null
): PriceRule | null {
  const isEEA = isEEAUser(userNationality);
  const attractionLower = attraction.toLowerCase();

  // 查找匹配规则
  const rules = KNOWN_PRICE_RULES.filter(r =>
    r.attraction.toLowerCase().includes(attractionLower) ||
    attractionLower.includes(r.attraction.toLowerCase())
  );

  if (rules.length === 0) return null;

  // 优先返回非EEA价格（如果是马来西亚用户）
  const isMalaysian = detectMalaysianUser(userOriginCity);

  if (!isEEA || isMalaysian) {
    const nonEEARule = rules.find(r => r.condition === 'non_eea');
    if (nonEEARule) return nonEEARule;
  }

  // 返回EEA价格
  const eeaRule = rules.find(r => r.condition === 'eea_resident');
  if (eeaRule) return eeaRule;

  // 返回通用价格
  return rules.find(r => r.condition === 'all') || rules[0];
}

/**
 * 格式化价格信息为提示词
 * 用于在搜索前注入到RAG查询中
 */
export function buildPriceContextPrompt(
  destination: string,
  userNationality: string | null,
  userOriginCity: string | null
): string {
  const parts: string[] = [];

  // 用户身份标记
  const isEEA = isEEAUser(userNationality);
  const isMalaysian = detectMalaysianUser(userOriginCity);

  if (isMalaysian) {
    parts.push(`⚠️ 重要：用户是马来西亚游客（非欧盟EEA公民）。`);
    parts.push(`查询欧洲景点票价时，必须查找"非欧盟游客价格"，而非本地居民优惠价。`);

    // 提供已知的目的地差价信息
    const knownPrice = getCorrectPrice(destination, userNationality, userOriginCity);
    if (knownPrice) {
      parts.push(`\n已知票价信息（${knownPrice.validity || '官方定价'}）：`);
      parts.push(`• ${destination}门票：€${knownPrice.price}（非EEA游客价格）`);
    }
  } else if (isEEA) {
    parts.push(`用户是EEA公民，可能享受欧盟优惠票价。`);
  }

  return parts.join('\n');
}

/**
 * 价格验证器
 * 用于检查LLM输出的票价是否正确
 */
export function validatePrice(
  attraction: string,
  quotedPrice: number,
  currency: string,
  userNationality: string | null,
  userOriginCity: string | null
): { isValid: boolean; correctPrice?: number; warning?: string } {
  const correctRule = getCorrectPrice(attraction, userNationality, userOriginCity);

  if (!correctRule) {
    // 无已知规则，无法验证
    return { isValid: true };
  }

  // 价格差异检测
  const tolerance = 2; // €2 容差
  const diff = Math.abs(quotedPrice - correctRule.price);

  if (diff > tolerance) {
    return {
      isValid: false,
      correctPrice: correctRule.price,
      warning: `检测到价格错误：${attraction}对于非EEA游客应为€${correctRule.price}，而非€${quotedPrice}。${correctRule.validity || ''}`
    };
  }

  return { isValid: true };
}

/**
 * 汇率转换表（常用货币）
 */
export const EXCHANGE_RATES: Record<string, Record<string, number>> = {
  EUR: { MYR: 4.8, USD: 1.08, SGD: 1.45, CNY: 7.8, THB: 38, JPY: 160 },
  USD: { MYR: 4.45, EUR: 0.93, SGD: 1.34, CNY: 7.2, THB: 35, JPY: 148 },
  MYR: { EUR: 0.21, USD: 0.22, SGD: 0.30, CNY: 1.62, THB: 7.9 },
  SGD: { MYR: 3.3, EUR: 0.69, USD: 0.75, CNY: 5.4, THB: 26 },
  CNY: { MYR: 0.62, EUR: 0.13, USD: 0.14, SGD: 0.19, THB: 4.9 },
};

/**
 * 货币转换
 */
export function convertCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string
): number {
  if (fromCurrency === toCurrency) return amount;

  const rates = EXCHANGE_RATES[fromCurrency];
  if (!rates || !rates[toCurrency]) {
    console.warn(`No exchange rate for ${fromCurrency} -> ${toCurrency}`);
    return amount; // 返回原值
  }

  return Math.round(amount * rates[toCurrency] * 100) / 100;
}