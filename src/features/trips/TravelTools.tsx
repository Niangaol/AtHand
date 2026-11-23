import { useCallback, useEffect, useState } from 'react';
import { CloudSun, Compass, Loader2, Map, Plane, Play, Route, Search, TrainFront } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { gatewayUrl, isGatewayConnected } from '../../data/gateway';
import { callMcpTool, listMcpTools } from '../../data/mcpTools';
import type { McpToolParam, McpToolView } from '../../data/mcpTools';
import { buildToolArguments, describeToolParams, matchToolsByScene, MCP_SCENES } from '../../domain/mcpToolbox';
import type { Trip } from '../../domain/planner';
import { prefillValues, sceneForLeg, summarizeCallResult } from '../../domain/travelTools';

const SCENE_ICON: Record<string, LucideIcon> = {
  flight: Plane,
  train: TrainFront,
  route: Route,
  nearby: Search,
  map: Map,
  weather: CloudSun,
};

type TravelToolsProps = {
  legs: Trip['transport'];
  city: string;
  today: string;
};

export function TravelTools({ legs, city, today }: TravelToolsProps) {
  const connected = isGatewayConnected();
  const cloud = /\/functions\/v1\/app$/.test(gatewayUrl().trim());
  const [tools, setTools] = useState<McpToolView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scene, setScene] = useState('');
  const [candidate, setCandidate] = useState<McpToolView | null>(null);
  const [params, setParams] = useState<McpToolParam[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!connected || cloud) return;
    setLoading(true);
    setError('');
    try {
      const list = await listMcpTools();
      setTools(list.filter((tool) => tool.risk === 'read'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '读取生活服务工具失败。');
    } finally {
      setLoading(false);
    }
  }, [connected, cloud]);

  useEffect(() => { void refresh(); }, [refresh]);

  function openTool(tool: McpToolView, context: Parameters<typeof prefillValues>[1]) {
    const nextParams = describeToolParams(tool);
    setCandidate(tool);
    setParams(nextParams);
    setValues(prefillValues(nextParams, context));
    setResult('');
  }

  function pickScene(sceneId: string) {
    const sceneLeg = legs.find((leg) => sceneForLeg(leg) === sceneId) ?? legs[0];
    const context = {
      ref: sceneLeg?.ref,
      date: sceneLeg?.date || today,
      from: sceneLeg?.from,
      to: sceneLeg?.to,
      city,
      keyword: city,
    };
    const matches = matchToolsByScene(sceneId, tools);
    setScene(sceneId);
    setResult('');
    if (!matches.length) {
      setCandidate(null);
      setParams([]);
      setValues({});
      return;
    }
    if (matches.length === 1) { openTool(matches[0], context); return; }
    // 多个工具时先让用户选；参数等选中后再预填。
    setCandidate(null);
    setParams([]);
    setValues({});
  }

  async function run() {
    if (!candidate) return;
    setBusy(true);
    setResult('');
    try {
      const args = buildToolArguments(params, values);
      const response = await callMcpTool(candidate.name, args);
      setResult(summarizeCallResult(response));
    } catch (caught) {
      setResult(caught instanceof Error ? caught.message : '调用失败。');
    } finally {
      setBusy(false);
    }
  }

  if (!connected || cloud) {
    return <section className="panel travel-tools" aria-label="旅程工具">
      <h2><Compass size={19} /> 旅程工具</h2>
      <p className="form-hint">{cloud ? '当前连的是云端后端，高德和飞常准跑在电脑上的本机网关里。' : '还没有连接本机网关。'} 先到 <Link className="text-link" to="/settings">设置页</Link> 连接本机网关，再去 <Link className="text-link" to="/services">生活服务</Link> 填高德/飞常准的 Key。</p>
    </section>;
  }

  const sceneMatches = scene ? matchToolsByScene(scene, tools) : [];
  const sceneLabel = MCP_SCENES.find((item) => item.id === scene)?.label ?? '';
  const hasFlight = legs.some((leg) => sceneForLeg(leg) === 'flight');
  const hasTrain = legs.some((leg) => sceneForLeg(leg) === 'train');

  return <section className="panel travel-tools" aria-label="旅程工具">
    <div className="travel-tools-head">
      <div>
        <h2><Compass size={19} /> 旅程工具</h2>
        <p className="form-hint">用高德查路线、周边和专属地图，用飞常准查航班动态和火车余票。没有配好的服务不会假装能用。</p>
      </div>
      <button type="button" className="button secondary compact" disabled={loading} onClick={() => void refresh()}>
        {loading ? <Loader2 size={14} className="spin" /> : null} 刷新工具
      </button>
    </div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {!error && !loading && tools.length === 0 ? <p className="form-hint">还没有可用的只读工具。去 <Link className="text-link" to="/services">生活服务</Link> 配置高德或飞常准，再点「测试连接」。</p> : null}
    {tools.length > 0 ? <div className="travel-tools-scenes" role="group" aria-label="旅程快捷动作">
      {MCP_SCENES.filter((item) => ['flight', 'train', 'route', 'nearby', 'map', 'weather'].includes(item.id)).map((item) => {
        const Icon = SCENE_ICON[item.id] ?? Compass;
        const disabled = (item.id === 'flight' && !hasFlight) || (item.id === 'train' && !hasTrain);
        return <button type="button" key={item.id} className={`travel-scene${scene === item.id ? ' is-selected' : ''}`} disabled={disabled} title={disabled ? (item.id === 'flight' ? '先在交通里加一段飞机行程' : '先在交通里加一段火车行程') : undefined} onClick={() => pickScene(item.id)}>
          <Icon size={16} /><span>{item.label}</span>
          <small>{matchToolsByScene(item.id, tools).length} 个工具</small>
        </button>;
      })}
    </div> : null}
    {scene && sceneMatches.length === 0 && tools.length > 0 ? <p className="form-hint">「{sceneLabel}」没有匹配到已启用的只读工具。可以在下面直接挑一个工具调用。</p> : null}
    {scene && sceneMatches.length > 1 && !candidate ? <div className="travel-candidates" role="group" aria-label="选择工具">
      <p className="form-hint">「{sceneLabel}」匹配到 {sceneMatches.length} 个工具，选一个：</p>
      {sceneMatches.map((tool) => <button type="button" key={tool.name} className="button secondary compact" onClick={() => openTool(tool, { ref: legs.find((leg) => sceneForLeg(leg) === scene)?.ref, date: legs.find((leg) => sceneForLeg(leg) === scene)?.date || today, from: legs[0]?.from, to: legs[0]?.to, city, keyword: city })}>{tool.description || tool.name}</button>)}
    </div> : null}
    {!candidate ? <details className="travel-tool-picker">
      <summary>直接挑一个工具</summary>
      <div className="travel-tool-list">
        {tools.map((tool) => <button type="button" key={tool.name} className="button secondary compact" onClick={() => openTool(tool, { city, keyword: city, date: today })}>
          <strong>{tool.description || tool.name}</strong>
          <span className="form-hint">{tool.service} · {tool.name}</span>
        </button>)}
      </div>
    </details> : null}
    {candidate ? <div className="travel-tool-runner">
      <div className="travel-tool-runner-head">
        <div><strong>{candidate.description || candidate.name}</strong><p className="form-hint">{candidate.service} · {candidate.name}</p></div>
        <button type="button" className="text-link" onClick={() => { setCandidate(null); setResult(''); }}>收起</button>
      </div>
      <div className="travel-tool-fields">
        {params.length === 0 ? <p className="form-hint">这个工具不需要参数，直接执行。</p> : params.map((param) => <label key={param.name}>
          {param.name}{param.required ? ' *' : ''}
          {param.enum.length
            ? <select value={values[param.name] ?? ''} onChange={(event) => setValues({ ...values, [param.name]: event.target.value })}>
              <option value="">未选择</option>
              {param.enum.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            : <input value={values[param.name] ?? ''} onChange={(event) => setValues({ ...values, [param.name]: event.target.value })} placeholder={param.description || param.type} inputMode={param.type === 'integer' || param.type === 'number' ? 'numeric' : undefined} />}
        </label>)}
      </div>
      <div className="setting-actions">
        <button type="button" className="button secondary compact" disabled={busy} onClick={() => void run()}><Play size={14} />{busy ? '正在查询' : '执行'}</button>
        <Link className="text-link" to="/services">去配置服务</Link>
      </div>
      {result ? <pre className="travel-tool-result">{result}</pre> : null}
    </div> : null}
  </section>;
}
