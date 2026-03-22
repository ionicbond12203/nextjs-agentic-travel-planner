/**
 * 对话状态追踪器 (Dialogue State Tracker)
 *
 * 解决问题：防止已收集的槽位信息在后续对话中丢失
 * 核心功能：
 * 1. 追踪已收集的用户偏好信息
 * 2. 管理对话阶段（信息收集 → 规划 → 展示）
 * 3. 确保所有必要信息收集完毕后才能调用外部API
 */

export interface UserSlot {
  /** 已确认的出发城市 */
  originCity: string | null;
  /** 已确认的目的地 */
  destination: string | null;
  /** 旅行天数 */
  tripDuration: string | null;
  /** 旅行风格偏好 */
  travelStyle: string | null;
  /** 用户国籍（用于票价判断） */
  nationality: string | null;
  /** 用户所在货币区 */
  currency: string | null;
}

export interface DialogueState {
  /** 当前对话阶段 */
  stage: 'collecting' | 'planning' | 'presenting' | 'completed';
  /** 已收集的槽位 */
  slots: UserSlot;
  /** 历史确认记录（用于审计） */
  confirmations: string[];
  /** 待确认的槽位 */
  pendingSlots: string[];
}

/** 马来西亚主要机场城市 */
const MALAYSIA_AIRPORTS = ['KUL', 'PEN', 'JHB', 'KCH', 'BKI', 'LGK', 'IPH', 'TGG', 'SBW', 'MYY'];

/** 检测用户是否来自马来西亚 */
export function detectMalaysianUser(originCode: string | null): boolean {
  if (!originCode) return false;
  return MALAYSIA_AIRPORTS.includes(originCode.toUpperCase());
}

/** 获取用户对应的货币 */
export function getCurrencyForOrigin(originCode: string | null): string {
  if (!originCode) return 'MYR';
  const code = originCode.toUpperCase();

  // 马来西亚
  if (MALAYSIA_AIRPORTS.includes(code)) return 'MYR';
  // 新加坡
  if (code === 'SIN') return 'SGD';
  // 中国
  if (['PEK', 'PVG', 'CAN', 'SZX', 'HKG'].includes(code)) return 'CNY';
  // 泰国
  if (['BKK', 'HKT', 'CNX'].includes(code)) return 'THB';
  // 日本
  if (['NRT', 'HND', 'KIX', 'CTS'].includes(code)) return 'JPY';
  // 韩国
  if (['ICN', 'GMP'].includes(code)) return 'KRW';

  return 'USD';
}

/** 欧盟/欧洲经济区国家代码 */
const EEA_COUNTRIES = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IS', 'IE', 'IT',
  'LV', 'LI', 'LT', 'LU', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'CH'
];

/** 判断用户是否享有欧盟优惠票价 */
export function isEEAUser(nationality: string | null): boolean {
  if (!nationality) return false;
  return EEA_COUNTRIES.includes(nationality.toUpperCase());
}

/**
 * 初始化对话状态
 */
export function initDialogueState(): DialogueState {
  return {
    stage: 'collecting',
    slots: {
      originCity: null,
      destination: null,
      tripDuration: null,
      travelStyle: null,
      nationality: null,
      currency: null,
    },
    confirmations: [],
    pendingSlots: ['originCity', 'destination', 'tripDuration', 'travelStyle'],
  };
}

/**
 * 槽位填充状态检查
 * 返回缺失的必要槽位
 */
export function getMissingSlots(state: DialogueState): string[] {
  const missing: string[] = [];

  // 核心必填槽位
  if (!state.slots.originCity) missing.push('originCity');
  if (!state.slots.destination) missing.push('destination');
  if (!state.slots.tripDuration) missing.push('tripDuration');
  if (!state.slots.travelStyle) missing.push('travelStyle');

  return missing;
}

/**
 * 检查是否可以进入规划阶段
 */
export function canProceedToPlanning(state: DialogueState): boolean {
  const missing = getMissingSlots(state);
  return missing.length === 0;
}

/**
 * 检查是否可以调用航班搜索API
 * 规则：必须有明确的出发地和目的地
 */
export function canSearchFlights(state: DialogueState): boolean {
  return !!(state.slots.originCity && state.slots.destination);
}

/**
 * 构建状态摘要Prompt（注入到系统提示中）
 */
export function buildStateContextPrompt(state: DialogueState): string {
  const parts: string[] = ['【当前对话状态】'];

  // 阶段信息
  const stageNames: Record<string, string> = {
    collecting: '信息收集中',
    planning: '行程规划中',
    presenting: '方案展示中',
    completed: '已完成',
  };
  parts.push(`阶段：${stageNames[state.stage]}`);

  // 已收集的槽位
  const filledSlots: string[] = [];
  if (state.slots.originCity) filledSlots.push(`出发城市：${state.slots.originCity}`);
  if (state.slots.destination) filledSlots.push(`目的地：${state.slots.destination}`);
  if (state.slots.tripDuration) filledSlots.push(`行程天数：${state.slots.tripDuration}`);
  if (state.slots.travelStyle) filledSlots.push(`旅行风格：${state.slots.travelStyle}`);
  if (state.slots.nationality) filledSlots.push(`国籍：${state.slots.nationality}`);
  if (state.slots.currency) filledSlots.push(`货币偏好：${state.slots.currency}`);

  if (filledSlots.length > 0) {
    parts.push(`已确认信息：`);
    parts.push(filledSlots.map(s => `  - ${s}`).join('\n'));
  }

  // 待收集槽位
  const missing = getMissingSlots(state);
  if (missing.length > 0) {
    const slotNames: Record<string, string> = {
      originCity: '出发城市',
      destination: '目的地',
      tripDuration: '行程天数',
      travelStyle: '旅行风格偏好',
    };
    parts.push(`待收集：${missing.map(m => slotNames[m] || m).join('、')}`);
  }

  // 特殊状态标记
  const isMalaysian = detectMalaysianUser(state.slots.originCity);
  if (isMalaysian) {
    parts.push(`⚠️ 用户身份：马来西亚游客（非欧盟EEA公民），查询欧洲景点时需使用非欧盟票价`);
  }

  return parts.join('\n');
}

/**
 * 从对话历史中提取状态更新
 * 用于在每次对话后更新状态
 */
export function extractSlotFromMessage(
  message: string,
  currentSlot: string | null,
  slotType: 'originCity' | 'destination' | 'tripDuration' | 'travelStyle'
): string | null {
  // 如果已有值，保持不变
  if (currentSlot) return currentSlot;

  const lowerMessage = message.toLowerCase();

  // 出发城市提取
  if (slotType === 'originCity') {
    const airportPatterns: Record<string, RegExp> = {
      'KUL': /吉隆坡|kul|kuala lumpur/i,
      'PEN': /槟城|pen|penang/i,
      'JHB': /新山|jhb|johor bahru|jb/i,
      'KCH': /古晋|kch|kuching/i,
      'BKI': /亚庇|bki|kota kinabalu/i,
      'SIN': /新加坡|sin|singapore/i,
      'PEK': /北京|pek|beijing/i,
      'PVG': /上海|pvg|shanghai/i,
      'CAN': /广州|can|guangzhou/i,
      'SZX': /深圳|szx|shenzhen/i,
      'HKG': /香港|hkg|hong kong/i,
    };

    for (const [code, pattern] of Object.entries(airportPatterns)) {
      if (pattern.test(message)) {
        return code;
      }
    }
  }

  // 行程天数提取
  if (slotType === 'tripDuration') {
    const patterns = [
      /(\d+)\s*[-~到]\s*(\d+)\s*天/,
      /(\d+)\s*天/,
      /一周|7天/,
      /两周|14天/,
      /(\d+)\s*-\s*(\d+)(天|日)/,
    ];

    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match) {
        return message;
      }
    }

    // 选项匹配
    const durationKeywords: Record<string, string> = {
      '3-5天': '3-5天',
      '6-8天': '6-8天',
      '9-12天': '9-12天',
      '两周': '两周以上',
      '一周': '一周',
    };

    for (const [keyword, value] of Object.entries(durationKeywords)) {
      if (lowerMessage.includes(keyword)) {
        return value;
      }
    }
  }

  // 旅行风格提取
  if (slotType === 'travelStyle') {
    const styleKeywords: Record<string, string> = {
      '文化': '文化历史探索',
      '历史': '文化历史探索',
      '博物馆': '文化历史探索',
      '美食': '美食体验',
      '购物': '购物休闲',
      '艺术': '艺术博物馆',
    };

    for (const [keyword, style] of Object.entries(styleKeywords)) {
      if (lowerMessage.includes(keyword)) {
        return style;
      }
    }
  }

  return null;
}