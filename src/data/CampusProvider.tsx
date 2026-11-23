import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { isGatewayConnected } from './gateway';
import {
  cancelCampusAuth, getCampusCatalog, getCampusStatus, logoutCampusCloud, pollCampusAuth, runCampusOperation, startCampusAuth,
} from './campusCloud';
import type { CampusCatalog, CampusCloudStatus, CampusResult, CampusRunInput } from './campusCloud';
import { mapCalendar, mapCard, mapCourses, mapExams, mapNotices } from './campusMap';
import type { CampusCalendar, CampusCard, CampusCourse, CampusExam, CampusNotice } from '../features/campus/campusTypes';

type CampusSummary = {
  calendar: CampusCalendar | null;
  courses: CampusCourse[];
  exams: CampusExam[];
  card: CampusCard | null;
  notices: CampusNotice[];
  loading: boolean;
  errors: string[];
  loadedAt: string | null;
};

const EMPTY_SUMMARY: CampusSummary = {
  calendar: null, courses: [], exams: [], card: null, notices: [], loading: false, errors: [], loadedAt: null,
};

type CampusContextValue = {
  gateway: boolean;
  status: CampusCloudStatus | null;
  statusLoading: boolean;
  statusError: string;
  catalog: CampusCatalog | null;
  catalogLoading: boolean;
  catalogError: string;
  summary: CampusSummary;
  refreshStatus: () => Promise<CampusCloudStatus | null>;
  refreshCatalog: () => Promise<CampusCatalog | null>;
  refresh: () => Promise<void>;
  startAuth: (scopes?: string[]) => Promise<CampusCloudStatus | null>;
  pollAuth: () => Promise<CampusCloudStatus | null>;
  cancelAuth: () => Promise<CampusCloudStatus | null>;
  disconnect: () => Promise<CampusCloudStatus | null>;
  run: (input: CampusRunInput) => Promise<CampusResult>;
};

const CampusContext = createContext<CampusContextValue | null>(null);

const QUICK_READS = {
  scheduleNow: 'AcademicService_ScheduleNow',
  exams: 'AcademicService_StudentExam',
  card: 'CampusLifeService_CardBalance',
  feed: 'FeedService_Feed',
  schoolTime: 'AcademicService_SchoolTime',
};

export function CampusProvider({ children }: { children: ReactNode }) {
  const [gateway, setGateway] = useState(() => isGatewayConnected());
  const [status, setStatus] = useState<CampusCloudStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [catalog, setCatalog] = useState<CampusCatalog | null>(null);
  const catalogRef = useRef<CampusCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [summary, setSummary] = useState<CampusSummary>(EMPTY_SUMMARY);

  const refreshSnapshot = useCallback(async (current: CampusCloudStatus | null) => {
    setSummary((previous) => ({ ...previous, loading: true, errors: [] }));
    const tasks: Array<Promise<CampusResult>> = [
      runCampusOperation({ operationId: QUICK_READS.schoolTime }),
    ];
    if (current?.connected) {
      tasks.push(
        runCampusOperation({ operationId: QUICK_READS.scheduleNow }),
        runCampusOperation({ operationId: QUICK_READS.exams }),
        runCampusOperation({ operationId: QUICK_READS.card }),
        runCampusOperation({ operationId: QUICK_READS.feed }),
      );
    }
    const results = await Promise.allSettled(tasks);
    const values = results.map((item) => item.status === 'fulfilled' ? item.value : null);
    const errors: string[] = [];
    for (const item of values.slice(1)) {
      if (item && item.ok === false) errors.push(item.message ?? item.error ?? '有一项校园数据没有读到。');
    }
    setSummary({
      calendar: mapCalendar(values[0] ?? null),
      courses: mapCourses(values[1] ?? null),
      exams: mapExams(values[2] ?? null),
      card: mapCard(values[3] ?? null),
      notices: mapNotices(values[4] ?? null),
      loading: false,
      errors: [...new Set(errors)],
      loadedAt: new Date().toISOString(),
    });
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!isGatewayConnected()) {
      setGateway(false);
      setStatus(null);
      setStatusError('');
      setSummary(EMPTY_SUMMARY);
      return null;
    }
    setGateway(true);
    setStatusLoading(true);
    setStatusError('');
    try {
      const next = await getCampusStatus();
      setStatus(next);
      await refreshSnapshot(next);
      return next;
    } catch (reason) {
      setStatus(null);
      setStatusError(reason instanceof Error ? reason.message : '读取校园授权状态失败。');
      return null;
    } finally {
      setStatusLoading(false);
    }
  }, [refreshSnapshot]);

  const refreshCatalog = useCallback(async () => {
    if (!isGatewayConnected()) { catalogRef.current = null; setCatalog(null); return null; }
    if (catalogRef.current) return catalogRef.current;
    setCatalogLoading(true);
    setCatalogError('');
    try {
      const next = await getCampusCatalog();
      catalogRef.current = next;
      setCatalog(next);
      return next;
    } catch (reason) {
      setCatalogError(reason instanceof Error ? reason.message : '读取校园操作清单失败。');
      return null;
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    const update = () => {
      const on = isGatewayConnected();
      setGateway(on);
      if (on) {
        void refreshStatus();
        void refreshCatalog();
      } else {
        setStatus(null);
        setCatalog(null);
        setStatusError('');
        setSummary(EMPTY_SUMMARY);
      }
    };
    update();
    window.addEventListener('shunshou-gateway-change', update);
    return () => window.removeEventListener('shunshou-gateway-change', update);
  }, [refreshStatus, refreshCatalog]);

  const startAuth = useCallback(async (scopes?: string[]) => {
    await startCampusAuth(scopes);
    return refreshStatus();
  }, [refreshStatus]);

  const pollAuth = useCallback(async () => {
    const next = await pollCampusAuth();
    setStatus(next);
    if (next.connected) await refreshSnapshot(next);
    return next;
  }, [refreshSnapshot]);

  const cancelAuth = useCallback(async () => {
    const next = await cancelCampusAuth();
    setStatus(next);
    return next;
  }, []);

  const disconnect = useCallback(async () => {
    const next = await logoutCampusCloud();
    setStatus(next);
    setSummary(EMPTY_SUMMARY);
    return next;
  }, []);

  const run = useCallback(async (input: CampusRunInput) => {
    const result = await runCampusOperation(input);
    if (result.ok && input.confirm) void refreshStatus();
    return result;
  }, [refreshStatus]);

  const refresh = useCallback(async () => {
    await refreshStatus();
    await refreshCatalog();
  }, [refreshStatus, refreshCatalog]);

  const value = useMemo<CampusContextValue>(() => ({
    gateway, status, statusLoading, statusError, catalog, catalogLoading, catalogError, summary,
    refreshStatus, refreshCatalog, refresh, startAuth, pollAuth, cancelAuth, disconnect, run,
  }), [gateway, status, statusLoading, statusError, catalog, catalogLoading, catalogError, summary, refreshStatus, refreshCatalog, refresh, startAuth, pollAuth, cancelAuth, disconnect, run]);

  return <CampusContext.Provider value={value}>{children}</CampusContext.Provider>;
}

export function useCampus(): CampusContextValue {
  const value = useContext(CampusContext);
  if (!value) throw new Error('CampusProvider is required.');
  return value;
}