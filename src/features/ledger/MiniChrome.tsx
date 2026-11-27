import type { ReactNode } from 'react';
import { Activity, BatteryFull, Clock3, Cpu, Gauge, Monitor, Radio, Smartphone, Wifi, WifiOff, Zap } from 'lucide-react';
import type { DeviceStatus } from './device';

/** 四格信号：按在线状态与网络代际决定点亮格数，全部来自真实连接读数。 */
function SignalBars({ status }: { status: DeviceStatus }) {
  const quality = status.wifi ? 4 : status.effectiveType === '4g' ? 4 : status.effectiveType === '3g' ? 3 : status.effectiveType === '2g' ? 2 : 3;
  const lit = status.online ? quality : 1;
  return <svg className="wb-signal" width="18" height="13" viewBox="0 0 18 13" aria-hidden="true">
    {[0, 1, 2, 3].map((index) => <rect key={index} x={index * 4.6} y={10 - (index + 1) * 2.4} width="3" height={(index + 1) * 2.4 + 1} rx="0.8" fill={index < lit ? 'currentColor' : 'currentColor'} opacity={index < lit ? 1 : 0.24} />)}
  </svg>;
}

/** 电池外框 + 按真实电量填充 + 充电闪电。 */
function BatteryIcon({ status }: { status: DeviceStatus }) {
  const level = status.battery ?? 0;
  const width = Math.max(0, Math.min(1, level / 100)) * 15;
  return <svg className="wb-battery-svg" width="27" height="14" viewBox="0 0 27 14" aria-hidden="true">
    <rect x="0.6" y="0.6" width="22" height="12.8" rx="3.4" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
    <rect x="2.2" y="2.2" width={width} height="9.6" rx="2" fill="currentColor" />
    <path d="M24.2 4.6c1.6.5 2.3 1.7 2.3 2.4s-.7 1.9-2.3 2.4z" fill="currentColor" opacity="0.5" />
    {status.charging ? <path d="M12.6 1 8.4 7.6h3.5l-1 5.4 4.4-6.8h-3.5z" fill="#fff" stroke="none" /> : null}
  </svg>;
}

/** 顶部状态栏：时间、信号、Wi-Fi / 蜂窝、电量，均为当前设备实时读数。点按展开明细。 */
export function StatusBar({ status, onInfo }: { status: DeviceStatus; onInfo: () => void }) {
  return <div className="wb-statusbar" role="button" tabIndex={0} onClick={onInfo} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onInfo(); }} aria-label="查看本机状态">
    <div className="wb-sb-left"><b>{status.clock}</b><span>{status.dateText}</span></div>
    <div className="wb-sb-right">
      <SignalBars status={status} />
      {status.wifi ? <Wifi size={14} strokeWidth={2.2} /> : !status.online ? <WifiOff size={14} strokeWidth={2.2} /> : null}
      <span className="wb-net-text">{status.networkLabel}</span>
      <BatteryIcon status={status} />
      <b className="wb-battery-num">{status.battery === null ? '—' : `${status.battery}%`}</b>
      {status.charging ? <Zap size={11} className="wb-charging" /> : null}
    </div>
  </div>;
}

/** 微信小程序右上角胶囊：··· 与 ◉。 */
export function MiniCapsule({ onMenu, onHome, menuOpen }: { onMenu: () => void; onHome: () => void; menuOpen: boolean }) {
  return <div className="wb-capsule">
    <button type="button" onClick={onMenu} aria-label="打开菜单" aria-expanded={menuOpen}>
      <svg width="19" height="6" viewBox="0 0 19 6" aria-hidden="true"><circle cx="3" cy="3" r="2.1" fill="currentColor" /><circle cx="9.5" cy="3" r="2.1" fill="currentColor" /><circle cx="16" cy="3" r="2.1" fill="currentColor" /></svg>
    </button>
    <i className="wb-capsule-div" />
    <button type="button" onClick={onHome} aria-label="回到今天">
      <svg width="17" height="17" viewBox="0 0 17 17" aria-hidden="true"><circle cx="8.5" cy="8.5" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.5" /><circle cx="8.5" cy="8.5" r="2.5" fill="currentColor" /></svg>
    </button>
  </div>;
}

const rows = (status: DeviceStatus): { icon: ReactNode; label: string; value: string }[] => [
  { icon: <Clock3 size={15} />, label: '当前时间', value: `${status.dateText} ${status.clock}` },
  { icon: <Radio size={15} />, label: '网络类型', value: status.effectiveType && !status.wifi && status.networkLabel !== status.effectiveType.toUpperCase() ? `${status.networkLabel} · ${status.effectiveType.toUpperCase()}` : status.networkLabel },
  { icon: <Gauge size={15} />, label: '下行速率', value: status.downlink },
  { icon: <Activity size={15} />, label: '网络延迟', value: status.rtt },
  { icon: <BatteryFull size={15} />, label: '电池电量', value: status.battery === null ? '此浏览器不提供' : `${status.battery}%${status.charging ? ' · 充电中' : ''}` },
  { icon: <Smartphone size={15} />, label: '设备平台', value: status.platform },
  { icon: <Monitor size={15} />, label: '屏幕分辨率', value: `${status.screen} · ${status.dpr}` },
  { icon: <Cpu size={15} />, label: '处理器 / 内存', value: `${status.cores} · ${status.memory}` },
  { icon: <Wifi size={15} />, label: '联网状态', value: status.online ? '在线' : '离线' },
];

/** 「本机信息」底部面板：把状态栏背后读到的真实数据摊开给用户看。 */
export function DeviceSheet({ status, open, onClose }: { status: DeviceStatus; open: boolean; onClose: () => void }) {
  return <>
    <div className={`wb-mask${open ? ' show' : ''}`} onClick={onClose} />
    <div className={`wb-sheet wb-device-sheet${open ? ' open' : ''}`} role="dialog" aria-label="本机信息" aria-hidden={!open}>
      <div className="wb-handle" />
      <div className="wb-device-hd"><b>本机信息</b><span>实时读取 · 不上传</span><button type="button" onClick={onClose} aria-label="关闭本机信息">×</button></div>
      <p className="wb-device-tip">状态栏里的时间、网络与电量，都直接来自你这台设备的浏览器读数；不支持的接口会标为「不可用」。</p>
      <div className="wb-device-list">{rows(status).map((row) => <div className="wb-device-row" key={row.label}><i>{row.icon}</i><span>{row.label}</span><b>{row.value}</b></div>)}</div>
      <button type="button" className="wb-device-refresh" onClick={onClose}>知道了</button>
    </div>
  </>;
}

/** 首页「生活助理」状态卡：把设备信息直接摆在主界面上。 */
export function LiveStatusCard({ status, onInfo }: { status: DeviceStatus; onInfo: () => void }) {
  return <button type="button" className="wb-live" onClick={onInfo} aria-label="查看本机状态详情">
    <div className="wb-live-hd"><span className="wb-live-dot" />本机状态 · 实时<em>详情 ›</em></div>
    <div className="wb-live-grid">
      <div><small>现在</small><b>{status.clock}</b><span>{status.dateText}</span></div>
      <div><small>网络</small><b>{status.networkLabel}</b><span>{status.online ? (status.wifi ? '无线局域网' : '蜂窝数据') : '当前离线'}</span></div>
      <div><small>电量</small><b>{status.battery === null ? '—' : `${status.battery}%`}</b><span>{status.charging ? '充电中' : status.batterySupported ? '电池供电' : '接口不可用'}</span></div>
    </div>
  </button>;
}
