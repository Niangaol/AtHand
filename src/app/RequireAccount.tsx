import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { isGatewayConnected, isHostedSite } from '../data/gateway';

/**
 * 托管站点默认要求先登录账号；未登录时把地址记下来，登录后回到原页。
 * 本机开发（非 qoder.zone/site）和本机网关不强制，保留「先随便看看」的示例体验。
 */
export function RequireAccount({ children }: { children: ReactNode }) {
  const location = useLocation();
  if (!isHostedSite() || isGatewayConnected()) return <>{children}</>;
  return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
}