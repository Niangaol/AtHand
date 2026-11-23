import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Car, CloudSun, Coffee, Compass, MapPin, Package, Plane, Sparkles, TrainFront, Utensils } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PageHeading } from '../../components/PageHeading';
import { gatewayUrl, isGatewayConnected } from '../../data/gateway';
import { listMcpServices, mcpStateLabel } from '../../data/mcpServices';
import type { McpServiceView } from '../../data/mcpServices';

type ServiceCard = {
  name: string;
  label: string;
  icon: LucideIcon;
  description: string;
  risk: string;
  scenarios: string;
  apply: string;
  env: string;
  note?: string;
};

const SERVICES: ServiceCard[] = [
  { name: 'amap', label: '高德地图', icon: MapPin, description: '地点搜索、周边、路线规划、专属地图链接。', risk: '只读', scenarios: '地图 · 路线 · 出行', apply: 'https://lbs.amap.com/api/mcp-server/summary', env: 'AMAP_WEB_KEY' },
  { name: 'weather', label: '华风爱科天气', icon: CloudSun, description: '实况、预报、预警、AQI、分钟级降水；官方只有 stdio，需要自建 HTTP 桥。', risk: '只读', scenarios: '天气 · 日程', apply: 'https://platform.weathercn.com/doc/mcp.html', env: 'WEATHERCN_OPENAPI_KEY', note: '需要本地桥' },
  { name: 'variflight', label: '飞常准', icon: TrainFront, description: '航班动态、火车余票、空铁联运查询。', risk: '只读', scenarios: '出行', apply: 'https://ai.variflight.com/zh', env: 'VARIFLIGHT_KEY' },
  { name: 'kd100', label: '快递100', icon: Package, description: '快递轨迹、时效与价格查询，只查不寄。', risk: '只读', scenarios: '快递', apply: 'https://api.kuaidi100.com/document/how-to-use-mcp-service', env: 'KD100_KEY' },
  { name: 'fliggy', label: '飞猪', icon: Plane, description: '机票、酒店、火车票、门票搜索；不是 MCP，走本地 flyai 命令行。', risk: '只读', scenarios: '机酒 · 出行', apply: 'https://flyai.open.fliggy.com/docs', env: 'FLYAI_API_KEY', note: '需安装 CLI' },
  { name: 'didi', label: '滴滴', icon: Car, description: '打车预估、叫车、司机位置；叫车会产生真实订单。', risk: '下单需确认', scenarios: '出行', apply: 'https://mcp.didichuxing.com', env: 'DIDI_MCP_KEY' },
  { name: 'luckin', label: '瑞幸咖啡', icon: Coffee, description: '到店自取点单、订单查询；支付二维码交给你自己付。', risk: '下单需确认', scenarios: '点单', apply: 'https://open.lkcoffee.com/mcp', env: 'LUCKIN_MCP_TOKEN' },
  { name: 'mcd', label: '麦当劳', icon: Utensils, description: '麦乐送/到店取餐、菜单算价、积分；下单返回支付链接。', risk: '下单需确认', scenarios: '点单', apply: 'https://open.mcd.cn/mcp/doc', env: 'MCD_MCP_TOKEN' },
];

const SCENES = [
  {
    id: 'before', title: '出门前', icon: CloudSun, description: '看天气、查航班动态和火车余票。',
    services: ['weather', 'variflight'], action: { label: '打开旅记', to: '/trips' },
  },
  {
    id: 'onway', title: '在路上', icon: Car, description: '打车、查快递走到哪了。',
    services: ['didi', 'kd100'], action: { label: '打开助手', to: '/assistant' },
  },
  {
    id: 'arrive', title: '到了', icon: Compass, description: '查周边、规划路线、把行程点生成专属地图。',
    services: ['amap'], action: { label: '在旅记里用', to: '/trips' },
  },
  {
    id: 'eat', title: '吃点什么', icon: Coffee, description: '瑞幸到店自取、麦当劳点单，支付回官方 App。',
    services: ['luckin', 'mcd'], action: { label: '打开助手', to: '/assistant' },
  },
] as const;

function isCloudBackend(): boolean {
  return /\/functions\/v1\/app$/.test(gatewayUrl().trim());
}

export function ServicesPage() {
  const [services, setServices] = useState<McpServiceView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const connected = isGatewayConnected();
  const cloud = isCloudBackend();

  useEffect(() => {
    if (!connected || cloud) return;
    let active = true;
    setLoading(true);
    listMcpServices()
      .then((list) => { if (active) setServices(list); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : '读取生活服务状态失败。'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [connected, cloud]);

  const live = useMemo(() => new Map(services.map((service) => [service.name, service])), [services]);

  function statusBadge(name: string) {
    const service = live.get(name);
    if (!service) return null;
    const state = mcpStateLabel(service.state.status);
    return <span className={`state-badge${state.tone === 'warn' ? ' warn' : state.tone === 'idle' ? ' idle' : ''}`}>{state.text}</span>;
  }

  return <>
    <PageHeading title="出门这件事，顺手一点。" description="地图、天气、航班、快递、打车、点单都在电脑上的本机网关里。配好 Key 之后，页面和助手都能直接用。" />
    <section className={`panel services-connection${connected && !cloud ? ' ready' : ''}`}>
      <Sparkles size={21} />
      <div>
        <h2>{!connected ? '还没有连接本机网关' : cloud ? '当前连的是云端后端' : '本机网关已连接'}</h2>
        <p>{!connected
          ? '生活服务需要电脑上的顺手网关（npm run sync）。到设置页填写网关地址和访问口令后，这里会显示每个服务的状态。'
          : cloud
            ? '生活服务 MCP 运行在你的电脑上，云端页面连不到它。把设置页的服务地址改成本机网关（http://127.0.0.1:18787）后即可配置。'
            : loading ? '正在读取服务状态…' : error ? error : '下面按「什么时候用」分好了；没有配置的服务会明确显示「未配置」，助手不会假装能用。'}</p>
        <div className="setting-actions">
          <Link className="button secondary compact" to="/settings">去设置页配置</Link>
          <Link className="button secondary compact" to="/assistant">打开助手</Link>
        </div>
      </div>
    </section>

    <section className="services-scenes" aria-label="按场景使用">
      {SCENES.map((scene) => {
        const Icon = scene.icon;
        const ready = scene.services.filter((name) => live.get(name)?.state.status === 'ready').length;
        return <article className="panel services-scene-card" key={scene.id}>
          <div className="services-scene-head">
            <Icon size={20} />
            <h3>{scene.title}</h3>
            {live.size ? <span className="subtle-tag">{ready}/{scene.services.length} 就绪</span> : null}
          </div>
          <p>{scene.description}</p>
          <ul className="services-scene-services">
            {scene.services.map((name) => {
              const service = SERVICES.find((item) => item.name === name);
              return <li key={name}>{service?.label ?? name}{statusBadge(name)}</li>;
            })}
          </ul>
          <Link className="button secondary compact" to={scene.action.to}>{scene.action.label}</Link>
        </article>;
      })}
    </section>

    <section className="panel services-usage">
      <h2>说人话就行</h2>
      <ul>
        <li>「帮我查一下杭州西湖附近的咖啡店」——高德只读查询，直接执行。</li>
        <li>「CA1702 明天几点到北京」——飞常准查航班动态。</li>
        <li>「从宿舍打车到杭州东站」——滴滴会先报预估价格和车型，你回一句「确认」才真正叫车。</li>
        <li>「点一杯瑞幸生椰拿铁，到店自取」——先给商品和门店，确认后下单；支付二维码回到瑞幸 App 里自己付。</li>
      </ul>
      <p className="form-hint">顺手不会替你付款：支付类工具一律不执行，只把支付链接或二维码交给你。下单失败不会自动重试，避免重复下单。</p>
    </section>

    <details className="panel services-keys">
      <summary>服务与 Key（{SERVICES.length} 项）</summary>
      <div className="services-key-grid">
        {SERVICES.map((entry) => {
          const status = live.get(entry.name);
          const state = status ? mcpStateLabel(status.state.status) : null;
          const Icon = entry.icon;
          return <article className="services-key-card" key={entry.name}>
            <div className="services-card-head">
              <Icon size={18} />
              <div><h3>{entry.label}</h3><p className="services-scenarios">{entry.scenarios}</p></div>
              {state ? <span className={`state-badge${state.tone === 'warn' ? ' warn' : state.tone === 'idle' ? ' idle' : ''}`}>{state.text}</span> : null}
            </div>
            <p>{entry.description}</p>
            <div className="services-meta">
              <span className={`subtle-tag${entry.risk === '只读' ? '' : ' services-risk'}`}>{entry.risk}</span>
              {entry.note ? <span className="subtle-tag">{entry.note}</span> : null}
            </div>
            <p className="form-hint">Key 变量：<code>{entry.env}</code>{status?.configured ? ` · 已保存${status.urlMasked ? ` · ${status.urlMasked}` : ''}` : ''}</p>
            <div className="services-actions">
              <a className="text-link" href={entry.apply} target="_blank" rel="noreferrer">申请入口</a>
              <Link className="text-link" to="/settings">去配置</Link>
            </div>
          </article>;
        })}
      </div>
    </details>
  </>;
}
