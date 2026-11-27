import { useEffect, useState } from 'react';

/** 浏览器提供的设备能力：电池 / 网络 / 屏幕。这些接口不在标准 DOM 类型里，单独声明。 */
type BatteryLike = {
  level: number;
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};
type ConnectionLike = {
  type?: string;
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};
type NavWithDeviceApis = Navigator & {
  getBattery?: () => Promise<BatteryLike>;
  connection?: ConnectionLike;
  mozConnection?: ConnectionLike;
  webkitConnection?: ConnectionLike;
  deviceMemory?: number;
  hardwareConcurrency?: number;
  platform?: string;
};

export type DeviceStatus = {
  clock: string;
  dateText: string;
  online: boolean;
  wifi: boolean;
  networkLabel: string;
  effectiveType: string;
  downlink: string;
  rtt: string;
  battery: number | null;
  charging: boolean;
  batterySupported: boolean;
  platform: string;
  screen: string;
  dpr: string;
  cores: string;
  memory: string;
  saveData: boolean;
};

const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function readConnection(): ConnectionLike | undefined {
  const nav = navigator as NavWithDeviceApis;
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
}

/** 全部来自当前设备的真实读数，不做任何写死的展示值。 */
function snapshot(battery: BatteryLike | null): DeviceStatus {
  const now = new Date();
  const conn = readConnection();
  const online = navigator.onLine;
  const wifi = !!conn?.type && conn.type === 'wifi';
  const effectiveType = conn?.effectiveType ?? '';
  let networkLabel = '已连接';
  if (!online) networkLabel = '无网络';
  else if (wifi) networkLabel = 'Wi-Fi';
  else if (effectiveType) networkLabel = effectiveType.replace('slow-', '').toUpperCase();
  else if (conn?.type && conn.type !== 'unknown') networkLabel = conn.type.toUpperCase();

  const nav = navigator as NavWithDeviceApis;
  return {
    clock: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    dateText: `${now.getMonth() + 1}月${now.getDate()}日 ${weekdayNames[now.getDay()]}`,
    online,
    wifi,
    networkLabel,
    effectiveType,
    downlink: typeof conn?.downlink === 'number' ? `${conn.downlink} Mb/s` : '不可用',
    rtt: typeof conn?.rtt === 'number' ? `${conn.rtt} ms` : '不可用',
    battery: battery ? Math.round(battery.level * 100) : null,
    charging: battery?.charging ?? false,
    batterySupported: battery !== null,
    platform: nav.platform || navigator.userAgent.split(') ')[0]?.replace(/^.*\(/, '') || '未知设备',
    screen: `${window.screen.width} × ${window.screen.height}`,
    dpr: `${window.devicePixelRatio || 1}×`,
    cores: nav.hardwareConcurrency ? `${nav.hardwareConcurrency} 核` : '不可用',
    memory: typeof nav.deviceMemory === 'number' ? `${nav.deviceMemory} GB` : '不可用',
    saveData: conn?.saveData ?? false,
  };
}

/** 实时监听时间、网络、电量变化；不支持的 API 自动降级为「不可用」。 */
export function useDeviceStatus(): DeviceStatus {
  const [status, setStatus] = useState<DeviceStatus>(() => snapshot(null));

  useEffect(() => {
    let battery: BatteryLike | null = null;
    let alive = true;
    const refresh = () => { if (alive) setStatus(snapshot(battery)); };
    const conn = readConnection();
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    conn?.addEventListener?.('change', refresh);

    const nav = navigator as NavWithDeviceApis;
    if (typeof nav.getBattery === 'function') {
      void nav.getBattery().then((value) => {
        if (!alive) return;
        battery = value;
        refresh();
        battery.addEventListener('levelchange', refresh);
        battery.addEventListener('chargingchange', refresh);
      }).catch(() => { /* 隐私模式下读取被拒，保持「不可用」。 */ });
    }

    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
      conn?.removeEventListener?.('change', refresh);
      if (battery) {
        battery.removeEventListener('levelchange', refresh);
        battery.removeEventListener('chargingchange', refresh);
      }
    };
  }, []);

  return status;
}
