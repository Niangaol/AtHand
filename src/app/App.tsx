import { Link, Route, Routes } from 'react-router-dom';
import { Shell } from './Shell';
import { OverviewPage } from '../features/overview/OverviewPage';
import { LedgerPage } from '../features/ledger/LedgerPage';
import { EntryPage } from '../features/entry/EntryPage';
import { WorkplacesPage } from '../features/workplaces/WorkplacesPage';
import { MonthlyPage } from '../features/monthly/MonthlyPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { CampusPage } from '../features/campus/CampusPage';

export function App() {
  return <Routes><Route element={<Shell />}>
    <Route index element={<OverviewPage />} />
    <Route path="entry" element={<EntryPage />} />
    <Route path="entry/:id" element={<EntryPage />} />
    <Route path="ledger" element={<LedgerPage />} />
    <Route path="workplaces" element={<WorkplacesPage />} />
    <Route path="monthly" element={<MonthlyPage />} />
    <Route path="campus" element={<CampusPage />} />
    <Route path="settings" element={<SettingsPage />} />
    <Route path="*" element={<section className="panel planned-page"><h1>这页还不在顺手里</h1><p>地址可能写错了，先回到今天看看吧。</p><Link className="button primary" to="/">回到今天</Link></section>} />
  </Route></Routes>;
}
