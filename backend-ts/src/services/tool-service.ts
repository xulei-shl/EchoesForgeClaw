/**
 * 小工具节点外部 API（万年历 / 天气查询）。
 *
 * - 万年历：MXNZP 节假日/万年历 API（https://www.mxnzp.com）。凭据与基础地址在
 *   `/admin/settings`（mxnzp.app_id / mxnzp.app_secret / mxnzp.base_url）配置，
 *   初始值种子自 .env（MXNZP_APP_ID / MXNZP_APP_SECRET）；纯 .env 值作回退。
 * - 天气查询：wttr.in 免费公开服务（无需凭据），取 format=j1 JSON 后整理为结构化中文输出。
 *
 * 两个节点均为「无需配置」的基础节点：不绑定任何 llm/agent 配置，直接调用第三方 API。
 */

const DEFAULT_MXNZP_BASE_URL = 'https://www.mxnzp.com';
const WTTR_IN_URL = 'https://wttr.in';

/** 外部请求超时（ms）：wttr.in / mxnzp 均为轻量接口，15s 足够。 */
const TOOL_REQUEST_TIMEOUT_MS = 15_000;

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 小工具外部 API 调用失败（网络 / 响应异常），由路由映射为 502 + detail。 */
export class SmallToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmallToolError';
  }
}

interface MxnzpHolidayData {
  date?: string;
  /** 1=周一 … 7=周日 */
  weekDay?: number;
  lunarCalendar?: string;
  yearTips?: string;
  chineseZodiac?: string;
  solarTerms?: string;
  constellation?: string;
  typeDes?: string;
  suit?: string;
  avoid?: string;
  dayOfYear?: number;
  weekOfYear?: number;
}

interface MxnzpResponse {
  code: number;
  msg?: string;
  data?: MxnzpHolidayData;
}

/** 万年历数据 → 对外文本输出（Markdown 列表，仅含非空字段）。 */
function formatCalendar(d: MxnzpHolidayData, dateStr: string): string {
  const lines: string[] = [`# 万年历 · ${d.date ?? dateStr}`];
  if (d.weekDay != null && d.weekDay >= 1 && d.weekDay <= 7) {
    lines.push(`- **星期**：${WEEKDAYS[d.weekDay - 1]}`);
  }
  const rows: Array<[string, string | number | undefined]> = [
    ['农历', d.lunarCalendar],
    ['天干地支', d.yearTips],
    ['属相', d.chineseZodiac],
    ['节气', d.solarTerms],
    ['星座', d.constellation],
    ['类型', d.typeDes],
    ['宜', d.suit],
    ['忌', d.avoid],
    ['一年第几天', d.dayOfYear],
    ['一年第几周', d.weekOfYear],
  ];
  for (const [label, value] of rows) {
    if (value != null && String(value).trim() !== '') {
      lines.push(`- **${label}**：${String(value).trim()}`);
    }
  }
  return lines.join('\n');
}

/**
 * 查询指定日期的节假日 / 万年历信息。
 * @param date 日期，支持 yyyy-MM-dd 或 yyyyMMdd；缺省用今天
 * @param appId / appSecret MXNZP 应用凭据（/admin/settings，回退 .env）
 * @param baseUrl MXNZP API 基础地址（/admin/settings，默认官方地址）
 */
export async function fetchCalendar(
  date: string | undefined,
  appId: string,
  appSecret: string,
  baseUrl: string
): Promise<{ output: string; date: string }> {
  const normalized = (date ?? '').replace(/[-/]/g, '');
  if (!/^\d{8}$/.test(normalized)) {
    throw new SmallToolError('日期格式无效，应为 yyyy-MM-dd 或 yyyyMMdd');
  }
  if (!appId || !appSecret) {
    throw new SmallToolError('万年历服务未配置：请在管理端「系统设置」配置 mxnzp.app_id / mxnzp.app_secret（或在 .env 设置 MXNZP_APP_ID / MXNZP_APP_SECRET）');
  }
  const base = (baseUrl ?? '').trim().replace(/\/+$/, '') || DEFAULT_MXNZP_BASE_URL;
  const url = `${base}/api/holiday/single/${normalized}?app_id=${encodeURIComponent(appId)}&app_secret=${encodeURIComponent(appSecret)}&ignoreHoliday=false`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TOOL_REQUEST_TIMEOUT_MS) });
  if (!res.ok) {
    throw new SmallToolError(`万年历查询失败（HTTP ${res.status}）`);
  }
  let body: MxnzpResponse;
  try {
    body = (await res.json()) as MxnzpResponse;
  } catch {
    throw new SmallToolError('万年历服务返回了无法解析的内容');
  }
  if (body.code !== 1 || !body.data) {
    throw new SmallToolError(body.msg || '万年历查询失败，请检查 MXNZP 凭据是否有效');
  }
  return { output: formatCalendar(body.data, normalized), date: normalized };
}

/* ========================================================================= */
/* 天气查询（wttr.in format=j1 → 结构化中文输出）                            */
/* ========================================================================= */

/** wttr.in weatherCode → 中文天气描述（收录常用代码；未收录回退英文原文） */
const WEATHER_CODE_ZH: Record<string, string> = {
  '113': '晴',
  '116': '局部多云',
  '119': '多云',
  '122': '阴',
  '143': '薄雾',
  '176': '局部有雨',
  '263': '局部小雨',
  '266': '小雨',
  '293': '零星小雨',
  '296': '小雨',
  '299': '中雨',
  '302': '中雨',
  '305': '大雨',
  '308': '大雨',
  '311': '冻雨',
  '314': '冻雨',
  '317': '雨夹雪',
  '320': '雨夹雪',
  '323': '小雪',
  '326': '小雪',
  '329': '中雪',
  '332': '中雪',
  '335': '大雪',
  '338': '大雪',
  '350': '冰粒',
  '353': '阵雨',
  '356': '中阵雨',
  '359': '大阵雨',
  '362': '阵性雨夹雪',
  '365': '阵性雨夹雪',
  '368': '阵雪',
  '371': '大阵雪',
  '374': '冰粒',
  '377': '冰粒',
  '386': '雷阵雨',
  '389': '强雷阵雨',
  '392': '雷阵雪',
  '395': '强雷阵雪',
};

/** wttr.in 十六方位风向 → 中文 */
const WIND_DIR_ZH: Record<string, string> = {
  N: '北风',
  NNE: '北北东风',
  NE: '东北风',
  ENE: '东北偏东风',
  E: '东风',
  ESE: '东南偏东风',
  SE: '东南风',
  SSE: '南南东风',
  S: '南风',
  SSW: '南南西风',
  SW: '西南风',
  WSW: '西南偏西风',
  W: '西风',
  WNW: '西北偏西风',
  NW: '西北风',
  NNW: '北北西风',
};

/** wttr.in 月相 → 中文 */
const MOON_PHASE_ZH: Record<string, string> = {
  'New Moon': '新月',
  'Waxing Crescent': '蛾眉月',
  'First Quarter': '上弦月',
  'Waxing Gibbous': '盈凸月',
  'Full Moon': '满月',
  'Waning Gibbous': '亏凸月',
  'Last Quarter': '下弦月',
  'Waning Crescent': '残月',
};

/** 12 小时制（如 "02:56 AM"）→ 24 小时制 */
function to24h(t?: string): string {
  if (!t) return '';
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(t.trim());
  if (!m) return t.trim();
  let h = Number(m[1] ?? '0') % 12;
  if ((m[3] ?? '').toUpperCase() === 'PM') h += 12;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

interface WttrCurrentCondition {
  temp_C?: string;
  FeelsLikeC?: string;
  humidity?: string;
  cloudcover?: string;
  precipMM?: string;
  pressure?: string;
  visibility?: string;
  uvIndex?: string;
  weatherCode?: string;
  winddir16Point?: string;
  windspeedKmph?: string;
  observation_time?: string;
  weatherDesc?: { value?: string }[];
}

interface WttrDay {
  maxtempC?: string;
  mintempC?: string;
  astronomy?: { sunrise?: string; sunset?: string; moon_phase?: string }[];
}

interface WttrJson {
  current_condition?: WttrCurrentCondition[];
  nearest_area?: { areaName?: { value?: string }[]; country?: { value?: string }[] }[];
  weather?: WttrDay[];
}

/** 天气 JSON → 对外文本输出（结构化中文，人类可读）。 */
function formatWeather(city: string, body: WttrJson): string {
  const cc = body.current_condition?.[0];
  if (!cc) {
    throw new SmallToolError('未找到该城市的天气信息，请检查城市名');
  }
  const areaName = body.nearest_area?.[0]?.areaName?.[0]?.value ?? '';
  const country = body.nearest_area?.[0]?.country?.[0]?.value ?? '';
  const title = city || [areaName, country].filter(Boolean).join('，') || '当前位置';

  const descEn = cc.weatherDesc?.[0]?.value ?? '';
  const condition = WEATHER_CODE_ZH[String(cc.weatherCode ?? '')] ?? (descEn || '未知');
  const lines: string[] = [
    `# ${title} · 当前天气`,
    '',
    `**${condition}，${cc.temp_C ?? '--'}°C${cc.FeelsLikeC ? `（体感 ${cc.FeelsLikeC}°C）` : ''}**`,
  ];

  const rows: Array<[string, string]> = [];
  const wind = WIND_DIR_ZH[cc.winddir16Point ?? ''] ?? cc.winddir16Point ?? '';
  if (wind && cc.windspeedKmph != null) rows.push(['风向风速', `${wind} ${cc.windspeedKmph} km/h`]);
  if (cc.humidity != null) rows.push(['湿度', `${cc.humidity}%`]);
  if (cc.visibility != null) rows.push(['能见度', `${cc.visibility} km`]);
  if (cc.cloudcover != null) rows.push(['云量', `${cc.cloudcover}%`]);
  if (cc.precipMM != null) rows.push(['降水', `${cc.precipMM} mm`]);
  if (cc.pressure != null) rows.push(['气压', `${cc.pressure} hPa`]);
  if (cc.uvIndex != null) rows.push(['紫外线指数', cc.uvIndex]);
  const obs = to24h(cc.observation_time);
  if (obs) rows.push(['观测时间', obs]);
  for (const [label, value] of rows) lines.push(`- **${label}**：${value}`);

  // 今日预报与天文信息（日出日落 / 月相）
  const day = body.weather?.[0];
  const summary: string[] = [];
  if (day) {
    const temps: string[] = [];
    if (day.maxtempC != null) temps.push(`最高 ${day.maxtempC}°C`);
    if (day.mintempC != null) temps.push(`最低 ${day.mintempC}°C`);
    if (temps.length > 0) summary.push(`今日：${temps.join(' / ')}`);
    const astro = day.astronomy?.[0];
    if (astro) {
      const parts: string[] = [];
      const sunrise = to24h(astro.sunrise);
      const sunset = to24h(astro.sunset);
      if (sunrise) parts.push(`日出 ${sunrise}`);
      if (sunset) parts.push(`日落 ${sunset}`);
      if (astro.moon_phase) {
        parts.push(`月相：${MOON_PHASE_ZH[astro.moon_phase] ?? astro.moon_phase}`);
      }
      if (parts.length > 0) summary.push(parts.join(' · '));
    }
  }
  if (summary.length > 0) lines.push('', `> ${summary.join(' · ')}`);

  return lines.join('\n');
}

/**
 * 查询指定城市当前天气（wttr.in，结构化中文输出）。
 * @param city 城市名（中文 / 拼音 / 邮编等）；留空按 IP 自动定位
 */
export async function fetchWeather(city?: string): Promise<{ output: string; city: string }> {
  const q = (city ?? '').trim();
  const path = q ? `/${encodeURIComponent(q)}` : '';
  const url = `${WTTR_IN_URL}${path}?format=j1&lang=zh`;
  // wttr.in 按 User-Agent 区分客户端：浏览器 UA 返回 HTML 页面，curl 返回终端纯文本。
  // 服务端请求伪装 curl + Accept: application/json 以稳定拿到 JSON 结构。
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TOOL_REQUEST_TIMEOUT_MS),
    headers: { 'User-Agent': 'curl/8.5.0', Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new SmallToolError(`天气查询失败（HTTP ${res.status}）`);
  }
  let body: WttrJson;
  try {
    body = (await res.json()) as WttrJson;
  } catch {
    throw new SmallToolError('未找到该城市的天气信息，请检查城市名');
  }
  return { output: formatWeather(q, body), city: q };
}
