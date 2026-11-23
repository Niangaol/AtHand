export const agentToolLabels: Record<string, string> = {
  day_overview: '查看当天安排',
  schedule_list: '查看日程',
  schedule_create: '新建日程',
  schedule_update: '修改日程',
  courses_list: '查看课程',
  courses_create: '新建课程',
  courses_update: '修改课程',
  focus_start: '开始专注',
  focus_control: '控制专注',
  focus_summary: '专注摘要',
  countdowns_list: '查看倒计时',
  countdowns_create: '新建倒计时',
  countdowns_update: '修改倒计时',
  services_search: '搜索校园服务',
  campus_status: '查看校园连接',
  campus_calendar: '查看校历',
  campus_notices: '查看校园通知',
  campus_courses: '查看课表',
  campus_exams: '查看考试',
  campus_life: '查看校园生活数据',
  campus_sync_courses: '同步课表到日程',
  campus_sync_exams: '同步考试到日程',
  ledger_summary: '账本摘要',
  ledger_records: '账本明细',
  ledger_monthly: '月度汇总',
  ledger_workplaces: '查看兼职单位',
  workplaces_add: '新建兼职单位',
  workplaces_update: '修改兼职单位',
  ledger_add_expense: '记支出',
  ledger_update_expense: '修改支出',
  ledger_add_work: '记工时',
  ledger_update_work: '修改工时',
  trips_list: '查看旅记',
  trips_get: '查看旅行详情',
  trips_create: '新建旅行',
  trips_update: '修改旅行',
  trips_add_day_item: '添加行程',
  trips_add_packing: '添加打包项',
  trips_set_packing: '勾选打包项',
  trips_add_visit: '添加城市足迹',
};

// 生活服务 MCP 的工具名是「服务前缀_上游工具名」，这里只翻译服务前缀，
// 上游工具名保留原样，避免把不认识的英文工具硬翻成错误的中文。
const mcpServiceLabels: Record<string, string> = {
  amap: '高德地图',
  weather: '天气',
  fliggy: '飞猪',
  variflight: '飞常准',
  kd100: '快递100',
  didi: '滴滴',
  luckin: '瑞幸',
  mcd: '麦当劳',
};

export function toolLabel(name: string): string {
  const fixed = agentToolLabels[name];
  if (fixed) return fixed;
  const index = name.indexOf('_');
  if (index > 0) {
    const service = mcpServiceLabels[name.slice(0, index)];
    if (service) return `${service} · ${name.slice(index + 1)}`;
  }
  return name;
}
