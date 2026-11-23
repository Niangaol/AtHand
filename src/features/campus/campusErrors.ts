/** 校园操作的错误提示与下一步动作。
 *
 * 云端校园代理的错误码来自 functions/campus.mjs 与 docs/campus.md；
 * 这里把「错在哪 + 下一步能点什么」统一成一份，避免每个调用点各写一套文案。
 */
export type CampusErrorAction = 'reconnect' | 'authorize' | 'retry' | 'confirm' | 'edit' | 'none';

export type CampusErrorHint = {
  title: string;
  detail: string;
  action: CampusErrorAction;
  actionLabel: string;
};

export function campusErrorHint(error: string | undefined, missingScopes: string[] = []): CampusErrorHint {
  switch (error) {
    case 'campus_not_connected':
      return {
        title: '还没有连接校园助手',
        detail: '先在校园页生成 HDUHelp 授权链接，在你的 HDUHelp 账号里确认设备与权限；授权完成后这里会自动继续。',
        action: 'reconnect',
        actionLabel: '去连接校园助手',
      };
    case 'campus_pat_invalid':
      return {
        title: '校园授权已失效',
        detail: '个人访问令牌可能被撤销或过期。断开后重新授权一次即可，已写入的课表和考试不会受影响。',
        action: 'reconnect',
        actionLabel: '重新授权',
      };
    case 'missing_scope':
      return {
        title: '当前授权缺少权限',
        detail: missingScopes.length
          ? `缺少：${missingScopes.join('、')}。补充授权后重试这一步。`
          : '这次操作需要的权限还没有授到。点下面的按钮补充授权，再重试。',
        action: 'authorize',
        actionLabel: '授权缺少的权限',
      };
    case 'upstream_timeout':
      return {
        title: '学校服务响应超时',
        detail: 'HDUHelp 或学校系统这次没有及时返回。稍等一会儿再试，查询类操作可以重复执行。',
        action: 'retry',
        actionLabel: '稍后重试',
      };
    case 'upstream_unreachable':
      return {
        title: '连不上学校服务',
        detail: '可能是校园网、学校系统维护或临时故障。换个网络或稍后再试；不要重复提交写操作。',
        action: 'retry',
        actionLabel: '稍后重试',
      };
    case 'confirmation_required':
      return {
        title: '写操作需要先确认',
        detail: '报名、选座、群聊这类操作会真正改动学校系统。先勾选确认（高风险操作输入「确认执行」），再提交一次。',
        action: 'confirm',
        actionLabel: '回到确认',
      };
    case 'invalid_arguments':
      return {
        title: '参数不符合接口要求',
        detail: '按表单提示核对必填项、日期格式和取值范围后再提交。',
        action: 'edit',
        actionLabel: '修改参数',
      };
    default:
      return {
        title: '操作没有完成',
        detail: '可以展开「原始返回」查看错误码；查询类操作可以重试，写操作请先确认参数。',
        action: 'none',
        actionLabel: '',
      };
  }
}
