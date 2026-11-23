import { useState, type CSSProperties } from 'react';
import { ArrowUpRight, Clock3 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { shortDate } from '../../domain/dates';
import { money } from '../../domain/summary';
import { barLabel, buildWeekChart, dayLabels, formatYuanShort, type DayPoint } from '../../domain/chart';

/**
 * 双轨账本柱：中间基线，上半轴收入（墨绿实心），下半轴支出（朱砂），
 * 上下同一元/像素比。列高由 chart.ts 算好，组件只负责摆放和交互。
 */
const PLOT_HEIGHT = 200;

function amountText(cents: number): string {
  return cents === 0 ? '0' : money(cents);
}

function tipSide(index: number, total: number): string {
  if (index === 0) return ' is-start';
  if (index === total - 1) return ' is-end';
  return '';
}

export function WeeklyChart({ daily, today, workMinutes }: { daily: DayPoint[]; today: string; workMinutes: number }) {
  const chart = buildWeekChart(daily, PLOT_HEIGHT);
  const [active, setActive] = useState<string | null>(null);

  const totalIncome = daily.reduce((sum, day) => sum + day.incomeCents, 0);
  const totalExpense = daily.reduce((sum, day) => sum + day.expenseCents, 0);
  const hasRecords = totalIncome !== 0 || totalExpense !== 0;
  const first = daily[0]?.date;
  const last = daily.length > 0 ? daily[daily.length - 1].date : undefined;
  const range = first && last ? `${shortDate(first)} — ${shortDate(last)}` : shortDate(today);
  const caption = hasRecords
    ? `本周收入 ${money(totalIncome)} 元，支出 ${money(totalExpense)} 元，净额 ${money(totalIncome - totalExpense)} 元；按天明细见下方表格。`
    : '本周还没有收支记录';

  const open = (date: string) => setActive(date);
  const close = (date: string) => setActive((current) => (current === date ? null : current));

  return (
    <section className="panel chart-panel">
      <div className="section-heading">
        <div>
          <h2>钱与时间的一周</h2>
          <p>{range}</p>
        </div>
        <Link className="icon-link" to="/ledger" aria-label="查看完整周账单"><ArrowUpRight size={20} /></Link>
      </div>
      <div className="chart-legend">
        <span><i className="income-dot" />收入</span>
        <span><i className="expense-dot" />支出</span>
        <span className="chart-unit">单位：元</span>
      </div>
      <figure className="chart-figure">
        <figcaption className="chart-sr-only">{caption}</figcaption>
        <div className="chart-body">
          <div className="chart-scale" aria-hidden="true">
            {chart.ticks.map((tick) => (
              <span key={`${tick.side}-${tick.yuan}`} className="chart-axis" style={{ top: `${chart.halfHeight - tick.offset}px` }}>
                {formatYuanShort(tick.yuan * 100)}
              </span>
            ))}
            <span className="chart-axis is-zero" style={{ top: `${chart.halfHeight}px` }}>0</span>
          </div>
          <div className="chart-plot">
            <div className="chart-grid" aria-hidden="true">
              {chart.ticks.map((tick) => (
                <span key={`${tick.side}-${tick.yuan}-line`} className="chart-gridline" style={{ top: `${chart.halfHeight - tick.offset}px` }} />
              ))}
              <span className="chart-gridline is-baseline" style={{ top: `${chart.halfHeight}px` }} />
            </div>
            <div className="chart-columns">
              {chart.columns.map((column, index) => {
                const day = daily[index];
                const isToday = column.date === today;
                const isEmpty = day.incomeCents === 0 && day.expenseCents === 0;
                const incomeLabel = column.incomeLabel ?? (isToday ? barLabel(day.incomeCents, column.incomeHeight) : null);
                const expenseLabel = column.expenseLabel ?? (isToday ? barLabel(day.expenseCents, column.expenseHeight) : null);
                return (
                  <div
                    key={column.date}
                    className={`chart-day${isToday ? ' is-today' : ''}${isEmpty ? ' is-empty' : ''}`}
                    style={{ '--chart-index': index } as CSSProperties}
                    tabIndex={0}
                    role="img"
                    aria-label={`${dayLabels[index]}：收入 ${amountText(day.incomeCents)} 元，支出 ${amountText(day.expenseCents)} 元`}
                    onMouseEnter={() => open(column.date)}
                    onMouseLeave={() => close(column.date)}
                    onFocus={() => open(column.date)}
                    onBlur={() => close(column.date)}
                    onClick={() => open(column.date)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.stopPropagation();
                        setActive(null);
                      }
                    }}
                  >
                    <div className="chart-bars" style={{ height: `${chart.halfHeight * 2}px` }}>
                      <span className="chart-bar is-income" style={{ height: `${column.incomeHeight}px` }} aria-hidden="true" />
                      <span className="chart-bar is-expense" style={{ height: `${column.expenseHeight}px` }} aria-hidden="true" />
                      {isEmpty ? <span className="chart-empty-mark" aria-hidden="true" /> : null}
                      {incomeLabel ? (
                        <span
                          className="chart-value is-income"
                          style={{ bottom: `calc(50% + ${column.incomeHeight}px + 3px)` }}
                          aria-hidden="true"
                        >{incomeLabel}</span>
                      ) : null}
                      {expenseLabel ? (
                        <span
                          className="chart-value is-expense"
                          style={{ top: `calc(50% + ${column.expenseHeight}px + 3px)` }}
                          aria-hidden="true"
                        >{expenseLabel}</span>
                      ) : null}
                    </div>
                    <span className="chart-day-label">{dayLabels[index].slice(-1)}</span>
                    {isToday ? <span className="chart-today-mark" aria-hidden="true" /> : null}
                    {active === column.date ? (
                      <div className={`chart-tip${tipSide(index, chart.columns.length)}`}>
                        <span className="chart-tip-date">{shortDate(column.date)} {dayLabels[index]}</span>
                        <span className="chart-tip-row"><span>收入</span><strong>¥ {money(day.incomeCents)}</strong></span>
                        <span className="chart-tip-row"><span>支出</span><strong>¥ {money(day.expenseCents)}</strong></span>
                        <span className="chart-tip-row"><span>净额</span><strong>¥ {money(day.netCents)}</strong></span>
                        <span className="chart-tip-row"><span>工时</span><strong>{(day.workMinutes / 60).toFixed(1)} 小时</strong></span>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <details className="chart-details">
          <summary>看这周的数字</summary>
          <div className="chart-table-wrap">
            <table className="chart-table">
              <caption className="chart-sr-only">本周每日收支明细</caption>
              <thead>
                <tr>
                  <th scope="col">日期</th>
                  <th scope="col">收入</th>
                  <th scope="col">支出</th>
                  <th scope="col">净额</th>
                  <th scope="col">工时</th>
                </tr>
              </thead>
              <tbody>
                {chart.columns.map((column, index) => {
                  const day = daily[index];
                  return (
                    <tr key={column.date} className={column.date === today ? 'is-today' : undefined}>
                      <th scope="row">{shortDate(column.date)} {dayLabels[index]}</th>
                      <td>¥ {money(day.incomeCents)}</td>
                      <td>¥ {money(day.expenseCents)}</td>
                      <td>¥ {money(day.netCents)}</td>
                      <td>{(day.workMinutes / 60).toFixed(1)} 小时</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      </figure>
      <div className="chart-footnote">
        <Clock3 size={15} />
        <span>本周累计工作 <strong>{(workMinutes / 60).toFixed(1)} 小时</strong></span>
        <span>周一至周日</span>
      </div>
    </section>
  );
}
