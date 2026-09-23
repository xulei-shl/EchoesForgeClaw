import { afterEach, describe, expect, it } from 'vitest';
import { isLoopbackWsUrl, resolveLightpandaEndpoint } from '../../src/services/node/vufind-service.js';
import { safeWsLabel } from '../../src/services/platform/cdp-websocket.js';

const ORIGINAL_BROWSER_ADDRESS = process.env.BROWSER_ADDRESS;

afterEach(() => {
  if (ORIGINAL_BROWSER_ADDRESS === undefined) delete process.env.BROWSER_ADDRESS;
  else process.env.BROWSER_ADDRESS = ORIGINAL_BROWSER_ADDRESS;
});

describe('resolveLightpandaEndpoint', () => {
  it('默认走本机 CDP，代理关闭', () => {
    delete process.env.BROWSER_ADDRESS;
    expect(resolveLightpandaEndpoint({})).toEqual({
      url: 'ws://127.0.0.1:9222',
      proxy: '',
    });
  });

  it('local 模式使用 BROWSER_ADDRESS 覆盖地址', () => {
    process.env.BROWSER_ADDRESS = 'ws://10.0.0.9:9222';
    expect(resolveLightpandaEndpoint({ 'lightpanda.mode': 'local' }).url).toBe('ws://10.0.0.9:9222');
  });

  it('云端模式拼接 token 查询参数，并在已有 query 时用 & 连接（模式值大小写不敏感）', () => {
    expect(
      resolveLightpandaEndpoint({
        'lightpanda.mode': ' Cloud ',
        'lightpanda.cloud_wss_url': 'wss://euwest.cloud.lightpanda.io/ws',
        'lightpanda.cloud_api_key': 'abc123',
      }).url
    ).toBe('wss://euwest.cloud.lightpanda.io/ws?token=abc123');

    expect(
      resolveLightpandaEndpoint({
        'lightpanda.mode': 'cloud',
        'lightpanda.cloud_wss_url': 'wss://euwest.cloud.lightpanda.io/ws?browser=lightpanda',
        'lightpanda.cloud_api_key': 'abc 123',
      }).url
    ).toBe('wss://euwest.cloud.lightpanda.io/ws?browser=lightpanda&token=abc%20123');
  });

  it('云端模式缺地址或密钥时抛配置错误', () => {
    expect(() => resolveLightpandaEndpoint({ 'lightpanda.mode': 'cloud' })).toThrow(/cloud_wss_url/);
    expect(() =>
      resolveLightpandaEndpoint({
        'lightpanda.mode': 'cloud',
        'lightpanda.cloud_wss_url': 'wss://uswest.cloud.lightpanda.io/ws',
      })
    ).toThrow(/cloud_api_key/);
  });

  it('代理仅对外部端点生效：本机回环地址始终直连', () => {
    delete process.env.BROWSER_ADDRESS;
    const proxySettings = { 'http.proxy': 'http://127.0.0.1:7890', 'lightpanda.use_proxy': 'true' };

    expect(resolveLightpandaEndpoint(proxySettings).proxy).toBe('');

    process.env.BROWSER_ADDRESS = 'ws://10.0.0.9:9222';
    expect(resolveLightpandaEndpoint(proxySettings).proxy).toBe('http://127.0.0.1:7890');

    expect(
      resolveLightpandaEndpoint({
        ...proxySettings,
        'lightpanda.mode': 'cloud',
        'lightpanda.cloud_wss_url': 'wss://euwest.cloud.lightpanda.io/ws',
        'lightpanda.cloud_api_key': 'abc123',
      }).proxy
    ).toBe('http://127.0.0.1:7890');
  });

  it('未开启 use_proxy 时不返回代理', () => {
    process.env.BROWSER_ADDRESS = 'ws://10.0.0.9:9222';
    expect(
      resolveLightpandaEndpoint({ 'http.proxy': 'http://127.0.0.1:7890', 'lightpanda.use_proxy': 'false' }).proxy
    ).toBe('');
  });
});

describe('isLoopbackWsUrl', () => {
  it('识别回环地址', () => {
    expect(isLoopbackWsUrl('ws://127.0.0.1:9222')).toBe(true);
    expect(isLoopbackWsUrl('ws://localhost:9222')).toBe(true);
    expect(isLoopbackWsUrl('wss://euwest.cloud.lightpanda.io/ws?token=x')).toBe(false);
  });
});

describe('safeWsLabel', () => {
  it('日志展示串不含 token 等 query 凭据', () => {
    const label = safeWsLabel('wss://euwest.cloud.lightpanda.io/ws?token=super-secret');
    expect(label).toBe('wss://euwest.cloud.lightpanda.io/ws');
    expect(label).not.toContain('super-secret');
  });
});
