import { useState } from 'react';
import { geoNaturalEarth1, geoPath, geoGraticule10 } from 'd3-geo';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import landText from 'world-atlas/land-110m.json?raw';
import type { CityFootprint } from '../../domain/trips';
import { Link } from 'react-router-dom';

const topology = JSON.parse(landText) as Topology<{ land: GeometryCollection }>;
const projection = geoNaturalEarth1().fitExtent([[12, 12], [788, 408]], { type: 'Sphere' });
const path = geoPath(projection);
const land = path(feature(topology, topology.objects.land)) ?? '';
const grid = path(geoGraticule10()) ?? '';

export function CityMap({ cities }: { cities: CityFootprint[] }) {
  const [selected, setSelected] = useState('');
  const [zoom, setZoom] = useState(1);
  const city = cities.find((v) => v.cityId === selected);
  const center = city ? projection([city.longitude, city.latitude])! : [400, 210];
  const view = zoom === 1 ? '0 0 800 420' : `${center[0] - 400 / zoom} ${center[1] - 210 / zoom} ${800 / zoom} ${420 / zoom}`;
  return <section className="panel planner-panel planner-spaced" aria-label="城市足迹"><div className="planner-section-title"><div><h2>走过的地方</h2><p>只统计已确认、日期不晚于今天的到访。</p></div><span className="subtle-tag">{cities.length} 座城市</span></div>
    <div className="planner-actions"><button className="button secondary compact" onClick={() => setZoom(Math.min(zoom * 2, 8))} disabled={zoom === 8}>放大地图</button><button className="button secondary compact" onClick={() => setZoom(Math.max(zoom / 2, 1))} disabled={zoom === 1}>缩小地图</button><button className="button secondary compact" onClick={() => { setZoom(1); setSelected(''); }}>全图</button></div>
    <svg className="city-map" viewBox={view} role="group" aria-label="离线世界城市足迹地图"><title>世界陆地底图与已到访城市，可用下方列表选择城市</title><rect x="-800" y="-420" width="2400" height="1260" fill="#eceee6" /><path d={grid} fill="none" stroke="#dcdfd2" strokeWidth={0.5 / zoom} /><path d={land} fill="#d9dcce" stroke="#b4b8a6" strokeWidth={0.7 / zoom} />
      {cities.map((item) => { const point = projection([item.longitude, item.latitude]); return point ? <g key={item.cityId} role="button" aria-label={`地图上的${item.city}`} tabIndex={0} className="map-point" onClick={() => setSelected(item.cityId)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(item.cityId); } }} transform={`translate(${point[0]},${point[1]})`}><circle r={14 / zoom} fill="transparent" /><circle r={(selected === item.cityId ? 6 : 4.5) / zoom} fill="#9e3b27" stroke="#fdfdf9" strokeWidth={1.5 / zoom} /><title>{item.city} · {item.count}次</title></g> : null; })}
    </svg><p className="form-hint">底图：Natural Earth（公有领域），world-atlas 整理。离线可用；仅供旅行回顾，不用于导航或边界认定。<a href="/map-licenses.txt" target="_blank" rel="noreferrer">地图许可</a></p>
    {!cities.length ? <p className="planner-empty">还没有确认的到访记录，计划中的城市不会自动点亮。</p> : <ul className="city-list" aria-label="城市足迹列表">{cities.map((item) => <li key={item.cityId}><button className={`button secondary${selected === item.cityId ? ' selected' : ''}`} onClick={() => setSelected(item.cityId)}>{item.city} · {item.count}次 · 最近 {item.latest}</button></li>)}</ul>}
    {city ? <section className="city-detail" aria-label="城市详情"><h3>{city.city} · 到访 {city.count} 次</h3><p>最近一次：{city.latest}</p><ul>{city.visits.map((visit) => <li key={`${visit.tripId}:${visit.visitId}`}><Link to={`/trips/${encodeURIComponent(visit.tripId)}`}>{visit.tripTitle}</Link> · {visit.date}</li>)}</ul></section> : null}
  </section>;
}
