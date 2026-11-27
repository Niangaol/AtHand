import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Check, ChevronDown, ChevronRight, Clock3, CreditCard, Delete, Grid2X2, Mic, Pencil, Plus, Search, SquarePen, X } from 'lucide-react';
import { useRecords } from '../../data/RecordsProvider';
import { MAX_PHOTOS } from '../../domain/records';
import { parseAmount } from '../../domain/ledger';
import type { RecordDraft } from '../../domain/ledger';
import { clearBalanceBase, computeBalance, formatBalance, formatMoney, parseBalanceInput, writeBalanceBase } from './balance';
import type { BalanceBase } from './balance';
import { filesToPhotos } from './photo';
import { ensureWorkplace } from './workplace';
import {
  categoryParent, categoryStyles, dietCategories, incomeCategories, incomeCategoryStyles,
  moreCategories, readCustomCategories, readCustomIncomeCategories, recentCategories,
  writeCustomCategories, writeCustomIncomeCategories,
} from './categories';

type Tab = '支出' | '收入' | '余额';
const tabs: Tab[] = ['支出', '收入', '余额'];
const accounts = ['现金(CNY)', '微信', '支付宝', '银行卡'];
const keypadKeys: readonly (readonly string[])[] = [
  ['7', '8', '9', '-'],
  ['4', '5', '6', '+'],
  ['1', '2', '3', 'back'],
  ['.', '0', '', ''],
];

const yuan = (cents: number) => (cents / 100).toFixed(2);

/** 图 2 的分类格子：收入分类带彩色底，编辑态可改名 / 删除自建分类。 */
function CategoryGrid({ names, selected, income, editing, onPick, onRename, onDelete }: {
  names: readonly string[]; selected: string; income: boolean; editing: boolean;
  onPick: (name: string) => void; onRename: (name: string) => void; onDelete: (name: string) => void;
}) {
  return <div className="wb-cat-grid">{names.map((name) => {
    const style = (income ? incomeCategoryStyles[name] : categoryStyles[name]) ?? categoryStyles['其他'];
    const Icon = style.icon;
    return <div className={`wb-cat-cell${selected === name ? ' sel' : ''}`} key={name}>
      <button type="button" className="wb-cat-item" onClick={() => (editing ? onRename(name) : onPick(name))} aria-pressed={selected === name}>
        <span className="ci" style={style.bg ? { background: style.bg, borderRadius: 11 } : undefined}><Icon size={income ? 21 : 27} strokeWidth={1.65} color={style.color} /></span>
        <span>{name}</span>
      </button>
      {editing ? <button type="button" className="wb-cat-mini" onClick={() => onDelete(name)} aria-label={`删除分类 ${name}`}><X size={11} /></button> : null}
      {editing ? <button type="button" className="wb-cat-mini pencil" onClick={() => onRename(name)} aria-label={`重命名分类 ${name}`}><Pencil size={10} /></button> : null}
    </div>;
  })}</div>;
}

/** 图 1「记一笔」整屏 + 图 2「分类」面板 + 余额数字键盘，数据写入软件原有账本。 */
export function LifeExpenseScreen({ date, open, onClose, onSaved, notify, balanceBase, onBalanceChange }: {
  date: string; open: boolean; onClose: () => void; onSaved: (message: string) => void; notify: (message: string) => void;
  balanceBase: BalanceBase | null; onBalanceChange: (base: BalanceBase | null) => void;
}) {
  const { records, workplaces, today, saveWorkplace, saveRecord, saving, blocked } = useRecords();
  const [tab, setTab] = useState<Tab>('支出');
  const [amount, setAmount] = useState('');
  const [expenseCategory, setExpenseCategory] = useState('日用品');
  const [incomeCategory, setIncomeCategory] = useState<string>(incomeCategories[0]);
  const [accountIndex, setAccountIndex] = useState(0);
  const [remark, setRemark] = useState('');
  const [entryDate, setEntryDate] = useState(date);
  const [photos, setPhotos] = useState<string[]>([]);
  const [catOpen, setCatOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [customExpense, setCustomExpense] = useState<string[]>(readCustomCategories);
  const [customIncome, setCustomIncome] = useState<string[]>(readCustomIncomeCategories);
  // 分类面板的「添加 / 编辑」二级弹层：独立于面板滚动区，保证一定点得开。
  const [catDialog, setCatDialog] = useState<'' | 'add' | 'rename'>('');
  const [browseEdit, setBrowseEdit] = useState(false);
  const [catInput, setCatInput] = useState('');
  const [renaming, setRenaming] = useState('');
  const [catError, setCatError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // 余额输入框：未手动输入时展示自动算出的余额，一旦敲键盘就切成原始输入。
  const [balanceInput, setBalanceInput] = useState('');
  const [balanceTouched, setBalanceTouched] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const remarkRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const catInputRef = useRef<HTMLInputElement>(null);

  // 每次打开都回到一张干净的「支出」单：页签固定支出，清空上次未提交的内容。
  // 用 ref 只在 false→true 的那一刻重置，填写过程中日期变化不会把页签强行跳回。
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setTab('支出');
      setAmount(''); setRemark(''); setPhotos([]); setEntryDate(date);
      setExpenseCategory('日用品'); setIncomeCategory(incomeCategories[0]); setAccountIndex(0);
      setCatOpen(false); setSearchOpen(false); setQuery(''); setBrowseEdit(false);
      setCatDialog(''); setCatInput(''); setCatError(''); setRenaming(''); setError('');
      setBalanceInput(''); setBalanceTouched(false);
    }
    wasOpen.current = open;
  }, [open, date]);
  useEffect(() => { if (catDialog) window.setTimeout(() => catInputRef.current?.focus(), 60); }, [catDialog]);
  useEffect(() => {
    if (tab !== '余额') return;
    setBalanceInput(''); setBalanceTouched(false); setError('');
    // 回到余额页时显示基准里记的账户，之后仍可点这一行自由切换。
    if (balanceBase) {
      const index = accounts.indexOf(balanceBase.account);
      if (index >= 0) setAccountIndex(index);
    }
  }, [tab, balanceBase]);

  const isIncome = tab === '收入';
  const isBalance = tab === '余额';
  const category = isIncome ? incomeCategory : expenseCategory;
  // 起始余额默认 0，大数字显示「起始 + 全部历史收支」；敲键盘后切成用户正在输入的起始值。
  const balanceCents = useMemo(() => computeBalance(records, balanceBase), [records, balanceBase]);
  const balanceDisplay = balanceTouched ? balanceInput : formatBalance(balanceCents);
  const builtin = useMemo(() => {
    const list = isIncome ? [...incomeCategories] : [...recentCategories, ...dietCategories, ...moreCategories];
    return list.filter((name, index, all) => all.indexOf(name) === index);
  }, [isIncome]);
  const custom = isIncome ? customIncome : customExpense;
  const names = useMemo(() => [...custom, ...builtin.filter((name) => !custom.includes(name))]
    .filter((name) => !query.trim() || name.includes(query.trim())), [custom, builtin, query]);

  function openAdd() {
    setCatInput(''); setCatError(''); setCatDialog('add');
  }
  function openRename(name: string) {
    setRenaming(name); setCatInput(name); setCatError(''); setCatDialog('rename');
  }
  function closeDialog() { setCatDialog(''); setCatInput(''); setCatError(''); }

  function saveCategory() {
    const name = catInput.trim().slice(0, 20);
    if (!name) { setCatError('请输入分类名称。'); return; }
    if (catDialog === 'rename') {
      const next = custom.map((item) => (item === renaming ? name : item));
      if (isIncome) { writeCustomIncomeCategories(next); setCustomIncome(next); } else { writeCustomCategories(next); setCustomExpense(next); }
      if (category === renaming) (isIncome ? setIncomeCategory : setExpenseCategory)(name);
      notify(`分类已改为「${name}」`);
    } else {
      if ([...custom, ...builtin].includes(name)) { setCatError('这个分类已经有了。'); return; }
      const next = [...custom, name];
      if (isIncome) { writeCustomIncomeCategories(next); setCustomIncome(next); setIncomeCategory(name); }
      else { writeCustomCategories(next); setCustomExpense(next); setExpenseCategory(name); }
      notify(`已添加分类「${name}」`);
    }
    closeDialog();
  }
  function deleteCategory(name: string) {
    if (!custom.includes(name)) { notify('内置分类不能删除，可以改名或添加新分类。'); return; }
    const next = custom.filter((item) => item !== name);
    if (isIncome) {
      writeCustomIncomeCategories(next); setCustomIncome(next);
      if (incomeCategory === name) setIncomeCategory(incomeCategories[0]);
    } else {
      writeCustomCategories(next); setCustomExpense(next);
      if (expenseCategory === name) setExpenseCategory('日用品');
    }
    notify(`已删除分类「${name}」`);
  }
  function pickCategory(name: string) {
    (isIncome ? setIncomeCategory : setExpenseCategory)(name);
    setCatOpen(false); setQuery(''); setSearchOpen(false);
  }

  /** 自定义键盘：产出纯数字串（可带负号、两位小数），不依赖系统输入法。 */
  function pressKey(key: string) {
    setError('');
    setBalanceTouched(true);
    setBalanceInput((previous) => {
      if (key === 'back') return previous.slice(0, -1);
      if (key === '-') return previous.startsWith('-') ? previous.slice(1) : `-${previous}`;
      if (key === '+') return previous.startsWith('-') ? previous.slice(1) : previous;
      if (key === '.') return previous.includes('.') ? previous : `${previous || '0'}.`;
      if (/^\d$/.test(key)) {
        if (previous.includes('.') && previous.split('.')[1].length >= 2) return previous;
        if (previous === '0') return key;
        if (previous.replace(/[^\d]/g, '').length >= 7) return previous;
        return previous + key;
      }
      return previous;
    });
  }

  /** 用户填的是「起始余额」：当前余额 = 起始（首次默认 0）+ 全部历史收支。 */
  function saveBalance() {
    setError('');
    let cents = balanceBase?.cents ?? 0;
    if (balanceTouched) {
      const raw = balanceInput.trim();
      if (raw) {
        const parsed = parseBalanceInput(raw);
        if (parsed === null) { setError('余额格式不对，最多两位小数。'); return; }
        cents = parsed;
      } else cents = 0; // 清空输入 = 把起始余额设回 0
    }
    // 没敲键盘就点确定：保持原起始值（首次为默认 0），不把已经叠加过的历史收支再算一遍。
    const base: BalanceBase = { cents, date: entryDate, account: accounts[accountIndex], note: remark.trim() };
    try { writeBalanceBase(base); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '余额保存失败。'); return; }
    onBalanceChange(base);
    setBalanceInput(''); setBalanceTouched(false); setRemark('');
    notify(`起始余额 ${formatMoney(cents)}，加上全部历史收支后当前余额 ${formatMoney(computeBalance(records, base))}`);
    onClose();
  }
  function resetBalance() {
    clearBalanceBase();
    onBalanceChange(null);
    setBalanceInput(''); setBalanceTouched(false); setError('');
    notify('已清除起始余额，按默认 0 加上历史收支重新计算');
  }

  async function commit(keepOpen: boolean) {
    if (isBalance) return;
    setError('');
    let cents: number;
    try { cents = parseAmount(amount); } catch (reason) { setError(reason instanceof Error ? reason.message : '请填写金额。'); return; }
    setBusy(true);
    try {
      const photosValue = photos.length ? photos : undefined;
      let draft: RecordDraft;
      if (isIncome) {
        // 数据模型没有独立收入类型：以 1 小时 × 金额时薪承载，amountCents 恰好等于输入金额。
        const rate = (cents / 100).toFixed(2);
        const unitId = await ensureWorkplace('生活收入', rate, workplaces, saveWorkplace);
        draft = {
          type: 'work', date: entryDate, title: remark.trim() || `${incomeCategory}收入`, workplaceId: unitId,
          startTime: '00:00', endTime: '01:00', nextDay: false, duration: '60',
          hourlyRate: rate, amount: '', category: incomeCategory, photos: photosValue,
        };
      } else {
        draft = {
          type: 'expense', date: entryDate, title: remark.trim() || category, workplaceId: '',
          startTime: '', endTime: '', nextDay: false, duration: '', hourlyRate: '',
          amount, category, photos: photosValue,
        };
      }
      const result = await saveRecord(draft);
      if (!result.ok) throw new Error(result.message);
      onSaved(`已记一笔 ${category} ¥${yuan(cents)}${photos.length ? `（含 ${photos.length} 张照片）` : ''}`);
      setAmount(''); setRemark(''); setPhotos([]);
      if (keepOpen) notify('可以继续记下一笔');
      else { setCatOpen(false); onClose(); }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || saving || blocked;
  const isToday = entryDate === today;
  const dateLabel = `${isToday ? '今天' : ''}${Number(entryDate.slice(5, 7))}月${Number(entryDate.slice(8, 10))}日`;

  return <section className={`wb-screen wb-ledger${open ? ' active' : ''}`} aria-label="生活的收入与支出" aria-hidden={!open}>
    <div className="wb-ledger-hd">
      <button type="button" className="back" onClick={onClose} aria-label="返回周账单">‹</button>
      <b>记一笔</b>
      <div className="wb-lh-right">
        <button type="button" className="wb-chip" onClick={() => (isBalance ? resetBalance() : setCatOpen(true))}>{isBalance ? '重设' : '＄ 自定义'}</button>
        <button type="button" className="wb-check" onClick={() => (isBalance ? saveBalance() : void commit(false))} disabled={!isBalance && disabled} aria-label="完成"><Check size={19} strokeWidth={2.4} /></button>
      </div>
    </div>
    <div className="wb-tabs" role="tablist" aria-label="记账类型">
      {tabs.map((item) => <button type="button" role="tab" aria-selected={tab === item} key={item} className={tab === item ? 'on' : ''} onClick={() => setTab(item)}>{item}</button>)}
    </div>

    <div className="wb-amount-row">
      <input className={`wb-amount${isBalance ? ' balance' : ''}`} inputMode="decimal" aria-label={isBalance ? '起始余额（元）' : '金额（元）'} placeholder={isBalance ? '填入起始余额，默认 0' : '0.00'}
        value={isBalance ? balanceDisplay : amount}
        onChange={(event) => (isBalance ? (setBalanceTouched(true), setBalanceInput(event.target.value)) : setAmount(event.target.value))} />
      {isBalance ? null : <button type="button" className="wb-camera" onClick={() => photoRef.current?.click()}><Camera size={21} strokeWidth={1.6} />拍照</button>}
    </div>
    <div className="wb-amount-line" />
    <input ref={photoRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={async (event) => {
      const picked = Array.from(event.target.files ?? []);
      const converted = await filesToPhotos(picked);
      if (converted.length) setPhotos((list) => [...list, ...converted].slice(0, MAX_PHOTOS));
      event.target.value = '';
    }} />
    {!isBalance && photos.length ? <div className="wb-ledger-photos">{photos.map((src, index) => <div className="wb-photo-thumb" key={index}><img src={src} alt={`照片 ${index + 1}`} /><button type="button" onClick={() => setPhotos((list) => list.filter((_, i) => i !== index))} aria-label="删除照片"><X size={12} /></button></div>)}</div> : null}

    {isBalance ? null : <button type="button" className="wb-field" onClick={() => setCatOpen(true)}>
      <Grid2X2 size={17} className="f-ico" /><span className="f-label">分类</span>
      <span className="f-value">{isIncome ? '收入' : categoryParent(category)}<span className="sep">›</span>{category}</span>
      <ChevronRight size={16} className="f-arrow" />
    </button>}
    <button type="button" className="wb-field" onClick={() => setAccountIndex((index) => (index + 1) % accounts.length)}>
      <CreditCard size={17} className="f-ico" /><span className="f-label">账户</span>
      <span className="f-value">{accounts[accountIndex]}</span>
      <ChevronRight size={16} className="f-arrow" />
    </button>
    {isBalance ? null : <button type="button" className="wb-field" onClick={() => dateRef.current?.showPicker?.()}>
      <Clock3 size={17} className="f-ico" /><span className="f-label">时间</span>
      <span className="f-value">{dateLabel}</span>
      {isToday ? null : <button type="button" className="f-clear" onClick={(event) => { event.stopPropagation(); setEntryDate(today); }} aria-label="恢复今天"><X size={15} /></button>}
      <input ref={dateRef} type="date" min="2000-01-01" max="2100-12-31" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} hidden />
    </button>}
    <div className="wb-field">
      <span className="f-ico wb-note-ico">✎</span><span className="f-label">备注</span>
      <input ref={remarkRef} className="f-input" aria-label="备注" placeholder="..." maxLength={100} value={remark} onChange={(event) => setRemark(event.target.value)} />
      <button type="button" onClick={() => remarkRef.current?.focus()} aria-label="填写备注"><Mic size={17} className="f-arrow" /></button>
    </div>

    {isIncome ? <p className="wb-ledger-note">收入会实时计入本月收入与日历当日合计。</p> : null}
    {isBalance ? <p className="wb-ledger-note">当前余额 {formatMoney(balanceCents)} = 起始余额 {formatMoney(balanceBase?.cents ?? 0)} + 全部历史收支。改数字即改起始余额，第一次用默认 0。</p> : null}
    {error ? <p className="wb-ledger-note" role="alert" style={{ color: '#c34a3c' }}>{error}</p> : null}

    {isBalance ? <div className="wb-keypad" role="group" aria-label="余额数字键盘">
      <button type="button" className="wb-kp-collapse" onClick={onClose} aria-label="收起键盘并返回"><ChevronDown size={20} /></button>
      <div className="wb-kp-tabs">{tabs.map((item) => <button type="button" key={item} className={tab === item ? 'on' : ''} onClick={() => setTab(item)}>{item}</button>)}</div>
      <div className="wb-kp-grid">{keypadKeys.flat().map((key, index) => key === ''
        ? <span key={index} />
        : <button type="button" key={index} className={/^[-+]$/.test(key) || key === 'back' ? 'sym' : ''} onClick={() => pressKey(key)} aria-label={key === 'back' ? '退格' : key === '-' ? '负号' : key === '+' ? '正号' : key}>
          {key === 'back' ? <Delete size={20} strokeWidth={1.8} /> : key === '-' ? '−' : key === '+' ? '+' : key}
        </button>)}</div>
      <button type="button" className="wb-kp-confirm" onClick={saveBalance}>确定</button>
    </div> : <div className="wb-ledger-bottom">
      <button type="button" className="wb-lb ghost" disabled={disabled} onClick={() => void commit(true)}>再记一笔</button>
      <button type="button" className="wb-lb ghost" onClick={() => { setAmount(''); setRemark(''); setPhotos([]); notify('已清空本次输入'); }}>清空</button>
      <button type="button" className="wb-lb solid" disabled={disabled} onClick={() => void commit(false)}>完成</button>
    </div>}

    <div className={`wb-mask${catOpen ? ' show' : ''}`} onClick={() => { setCatOpen(false); closeDialog(); }} />
    <div className={`wb-sheet wb-cat-sheet${catOpen ? ' open' : ''}`} role="dialog" aria-label="选择分类" aria-hidden={!catOpen}>
      <div className="wb-cat-tools">
        <button type="button" onClick={openAdd} aria-label="添加分类"><Plus size={21} /></button>
        <span className="divider" />
        <button type="button" onClick={() => { setCatDialog(''); setCatInput(''); setCatError(''); setBrowseEdit((value) => !value); }} aria-label="编辑分类"><SquarePen size={19} /></button>
        <span className="divider" />
        <button type="button" onClick={() => setSearchOpen((value) => !value)} aria-label="搜索分类"><Search size={19} /></button>
        <button type="button" className="collapse" onClick={() => setCatOpen(false)} aria-label="收起分类面板"><ChevronDown size={21} /></button>
      </div>
      <div className={`wb-cat-search${searchOpen ? ' show' : ''}`}><input aria-label="搜索分类" placeholder="搜索分类" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      <div className="wb-cat-body">
        <div className="wb-cat-group">{isIncome ? '收入' : '支出分类'}</div>
        {names.length ? <CategoryGrid names={names} selected={category} income={isIncome} editing={browseEdit} onPick={pickCategory} onRename={openRename} onDelete={deleteCategory} />
          : <p className="wb-tpl-empty">没有找到这个分类，可以在下面添加一个。</p>}
        {browseEdit ? <p className="wb-cat-hint">点分类可改名，右上角 × 可删除自建分类；再点一次编辑图标退出。</p> : null}
        <button type="button" className="wb-cat-add" onClick={openAdd}><Plus size={15} />添加分类</button>
      </div>
      {catDialog ? <div className="wb-cat-dialog" role="dialog" aria-label={catDialog === 'add' ? '添加分类' : '重命名分类'}>
        <div className="wb-cat-dialog-mask" onClick={closeDialog} />
        <div className="wb-cat-dialog-box">
          <b>{catDialog === 'add' ? '添加分类' : '修改分类名称'}</b>
          <small>{isIncome ? '收入' : '支出'}分类 · 名称最多 20 个字</small>
          <input ref={catInputRef} aria-label="分类名称" placeholder="输入分类名称" maxLength={20} value={catInput}
            onChange={(event) => { setCatInput(event.target.value); setCatError(''); }}
            onKeyDown={(event) => { if (event.key === 'Enter') saveCategory(); }} />
          {catError ? <p className="wb-cat-error" role="alert">{catError}</p> : null}
          <div className="wb-cat-dialog-btns">
            <button type="button" onClick={closeDialog}>取消</button>
            <button type="button" onClick={saveCategory}>确定</button>
          </div>
        </div>
      </div> : null}
    </div>
  </section>;
}
