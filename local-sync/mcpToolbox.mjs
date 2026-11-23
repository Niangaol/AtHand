/** 生活服务 MCP 的「场景工具箱」——本机网关侧。
 *
 * 纯逻辑（场景匹配、参数表单、参数类型转换）放在 src/domain/mcpToolbox.ts，
 * 前端与本机网关共用同一份，避免两边各写一套匹配规则。
 * 这里只保留依赖网关实例的只读直调。
 */

export {
  MCP_SCENES, MCP_SCENE_BY_ID, matchToolsByScene, describeToolParams, buildToolArguments,
} from '../src/domain/mcpToolbox.ts';

/**
 * 只读直调：给页面用的 MCP 调用入口。
 * - 只允许 risk=read；
 * - 未配置/不可达返回明确错误，不假装可用；
 * - 结果按网关截断规则返回。
 */
export async function callReadOnlyTool(gateway, toolName, args = {}) {
  if (!gateway || typeof gateway.listTools !== 'function') {
    return { ok: false, code: 'mcp_unavailable', message: '本机网关没有启动生活服务。' };
  }
  const listing = await gateway.listTools({});
  const tool = listing.tools.find((item) => item.name === toolName);
  if (!tool) {
    const skipped = (listing.skipped ?? []).find((item) => item.name === toolName);
    const failure = (listing.errors ?? []).find((item) => item.name === toolName) ?? listing.errors?.[0];
    return {
      ok: false,
      code: skipped?.reason ?? failure?.code ?? 'tool_not_found',
      message: skipped?.message ?? failure?.message ?? '这个工具不在已启用的生活服务里，先去设置页配置并测试连接。',
    };
  }
  if (tool.risk !== 'read') {
    return { ok: false, code: 'tool_not_read_only', message: '这个工具会产生订单或涉及支付，请让助手先给你确认摘要，不要直接执行。' };
  }
  return gateway.callTool(toolName, args, {});
}
