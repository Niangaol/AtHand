# 校园助手操作盘点（2026-11-22）

本文档由 `functions/campus-manifest.mjs` 自动生成，盘点云端校园代理内置的全部操作。生成命令见文末。

- 操作总数：**199**
- 权限总数：**74**
- 域：**14**

> 可用性结论基于 manifest 的 `auth` / `scopes` / `requiresUser` / `risk` 字段推断，**未经真实账号逐项实测**；标「需授权」的操作要等用户完成 HDUHelp 设备授权后才能验证。

## 总表

| 域 | 操作数 | 只读 | 敏感只读 | 写入 | 高风险写入 |
| --- | --- | --- | --- | --- | --- |
| 教务（academic） | 31 | 14 | 11 | 4 | 2 |
| 长期记忆（agentops） | 5 | 0 | 2 | 2 | 1 |
| 校园生活（campuslife） | 33 | 26 | 3 | 1 | 3 |
| 空课表（emptyschedule） | 19 | 7 | 0 | 9 | 3 |
| 信息流与订阅（feed） | 5 | 2 | 1 | 1 | 1 |
| 研究生（graduate） | 3 | 1 | 2 | 0 | 0 |
| 群聊（groupchat） | 12 | 4 | 0 | 7 | 1 |
| 身份（identity） | 10 | 4 | 2 | 3 | 1 |
| 知识检索（knowledge） | 3 | 1 | 2 | 0 | 0 |
| 图书馆选座（librarybooking） | 10 | 2 | 4 | 1 | 3 |
| 校友传话（messaging） | 9 | 0 | 4 | 4 | 1 |
| 社区动态（moments） | 46 | 25 | 1 | 13 | 7 |
| 提醒与阳光长跑（reminder） | 11 | 2 | 3 | 4 | 2 |
| 文件上传（upload） | 2 | 0 | 0 | 2 | 0 |

## 分域明细

### 教务（academic）

课表、今明课程、成绩/GPA、考试、作业、教室、校历；校园页与助手都在用，优先保持。

| 操作 | 说明 | 风险 | 权限 | 必填参数 | 结论 |
| --- | --- | --- | --- | --- | --- |
| `academic config`（AcademicService_AcademicConfig） | 获取学年学期配置 | 只读 | 无 | — | 公开接口，无需授权 |
| `academic class fav get`（AcademicService_ClassQueryFavGet） | 获取选课收藏 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `academic class fav rank`（AcademicService_ClassQueryFavRank） | 选课收藏排行 | 只读 | 无 | — | 公开接口，无需授权 |
| `academic class fav set`（AcademicService_ClassQueryFavSet） | 设置选课收藏 | 写入 | 1 项 | classes(body) | 写操作，需显式确认 + Idempotency-Key |
| `academic class map`（AcademicService_ClassQueryMap） | 选课字典映射 | 只读 | 无 | — | 公开接口，无需授权 |
| `academic class search`（AcademicService_ClassQuerySearch） | 选课检索 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `academic classroom usage`（AcademicService_ClassroomUsage） | 获取教室占用 | 只读 | 无 | — | 公开接口，无需授权 |
| `academic course`（AcademicService_Course） | 按班级号批量查询课程 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `academic exam today`（AcademicService_DailyExam） | 查询本人指定日期考试安排 | 敏感只读 | 1 项 | — | 可用（需授权对应 scope） |
| `academic classroom`（AcademicService_GetClassrooms） | 获取教室列表 | 只读 | 无 | — | 公开接口，无需授权 |
| `academic course-simulation get`（AcademicService_GetCourseSimulation） | 获取模拟选课方案 | 只读 | 1 项 | schoolYear(query)、semester(query) | 可用（需授权对应 scope） |
| `academic library attendance`（AcademicService_LibraryAttendance） | 按维度查询本人图书馆在馆统计 | 敏感只读 | 1 项 | — | 可用（需授权对应 scope） |
| `academic library reading`（AcademicService_LibraryReading） | 按指标查询本人阅读数据 | 敏感只读 | 1 项 | — | 可用（需授权对应 scope） |
| `academic library share revoke`（AcademicService_LibraryRevokeShareID） | 关闭本人图书馆分享 | 高风险写入 | 1 项 | — | 写操作，需显式确认 + Idempotency-Key |
| `academic library share rotate`（AcademicService_LibraryRotateShareID） | 重新生成本人图书馆分享 ID | 高风险写入 | 1 项 | — | 写操作，需显式确认 + Idempotency-Key |
| `academic library seat reservations`（AcademicService_LibrarySeatReservations） | 查询本人图书馆座位预约 | 敏感只读 | 1 项 | — | 可用（需授权对应 scope） |
| `academic library seat rooms`（AcademicService_LibrarySeatRooms） | 查询图书馆座位房间与座位数 | 只读 | 无 | — | 公开接口，无需授权 |
| `academic library share create`（AcademicService_LibraryShareID） | 创建或获取本人图书馆分享 ID | 写入 | 1 项 | — | 写操作，需显式确认 + Idempotency-Key |
| `academic library share report`（AcademicService_LibrarySharedReport） | 根据分享 ID 查询脱敏图书馆报告 | 敏感只读 | 1 项 | share_id(query) | 可用（需授权对应 scope） |
| `academic homework chaoxing`（AcademicService_ListChaoxingHomework） | 查询本人学习通作业 | 敏感只读 | 1 项 | — | 可用（需授权对应 scope） |
| `academic person info`（AcademicService_PersonInfo） | 查询本人人员信息 | 敏感只读 | 1 项 | — | 可用（需授权对应 scope） |
| `academic gate-access`（AcademicService_PostStudentGateAccess） | 上报学生门禁放行时段 | 写入 | 1 项 | — | 写操作，需显式确认 + Idempotency-Key |
| `academic course-simulation replace`（AcademicService_ReplaceCourseSimulation） | 原子替换模拟选课方案 | 写入 | 1 项 | expectedRevision(body)、items(body)、schoolYear(body)、semester(body) | 写操作，需显式确认 + Idempotency-Key |
| `academic schedule`（AcademicService_Schedule） | 获取学期课表 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `academic schedule now`（AcademicService_ScheduleNow） | 查询本人今明课程 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `academic schooltime time`（AcademicService_SchoolTime） | 查询当前校历时间 | 只读 | 无 | — | 公开接口，无需授权 |
| `academic schooltime semester list-by-date`（AcademicService_SemesterListByDate） | 按日期范围查询学期列表 | 只读 | 无 | — | 公开接口，无需授权 |
| `academic exam`（AcademicService_StudentExam） | 查询本人学期考试安排 | 敏感只读 | 1 项 | — | 可用（需授权对应 scope） |
| `academic grade`（AcademicService_StudentGrade） | 查询本人本科成绩与绩点 | 敏感只读 | 1 项 | — | 可用（需授权对应 scope） |
| `academic school-roll-status`（AcademicService_StudentSchoolRollStatus） | 查询本人学籍状态 | 敏感只读 | 1 项 | — | 可用（需授权对应 scope） |
| `academic teaching-class`（AcademicService_TeachingClass） | 查询教学班 | 敏感只读 | 1 项 | — | 可用（需授权对应 scope） |

### 长期记忆（agentops）

Agent 长期记忆增删改查；供助手内部使用，不放进校园页。

| 操作 | 说明 | 风险 | 权限 | 必填参数 | 结论 |
| --- | --- | --- | --- | --- | --- |
| `agentops memories add`（AgentOpsService_AgentAddMemory） | 新增一条长期记忆 | 写入 | 1 项 | content(body) | Agent 内部记忆，不进校园页 |
| `agentops memories delete`（AgentOpsService_AgentDeleteMemory） | 删除一条长期记忆 | 高风险写入 | 1 项 | id(path) | Agent 内部记忆，不进校园页 |
| `agentops memories list`（AgentOpsService_AgentListMemories） | 列出本人的长期记忆 | 敏感只读 | 1 项 | — | Agent 内部记忆，不进校园页 |
| `agentops memories search`（AgentOpsService_AgentSearchMemories） | 搜索本人的长期记忆 | 敏感只读 | 1 项 | — | Agent 内部记忆，不进校园页 |
| `agentops memories update`（AgentOpsService_AgentUpdateMemory） | 修改一条长期记忆 | 写入 | 1 项 | id(path)、content(body) | Agent 内部记忆，不进校园页 |

### 校园生活（campuslife）

校园卡余额/流水、电费、二课、天气、失物、就业、志愿；校园页已覆盖高频项。

| 操作 | 说明 | 风险 | 权限 | 必填参数 | 结论 |
| --- | --- | --- | --- | --- | --- |
| `campuslife activities registration apply`（CampusLifeService_ApplyActivity） | 报名二课活动 | 高风险写入 | 2 项 | activityId(path) | 写操作，需显式确认 + Idempotency-Key |
| `campuslife electric binding bind`（CampusLifeService_BindRoom） | 按真实寝室绑定宿舍电表 | 写入 | 1 项 | room_id(body) | 写操作，需显式确认 + Idempotency-Key |
| `campuslife activities registration cancel`（CampusLifeService_CancelActivity） | 取消二课活动报名 | 高风险写入 | 2 项 | activityId(path) | 写操作，需显式确认 + Idempotency-Key |
| `campuslife card balance`（CampusLifeService_CardBalance） | 查询校园卡余额 | 敏感只读 | 1 项 | — | 可用（需授权对应 scope） |
| `campuslife card consume`（CampusLifeService_CardConsume） | 查询校园卡消费流水 | 敏感只读 | 1 项 | — | 可用（需授权对应 scope） |
| `campuslife card info`（CampusLifeService_CardInfo） | 查询校园卡信息 | 敏感只读 | 1 项 | — | 可用（需授权对应 scope） |
| `campuslife electric balance`（CampusLifeService_ElectricBalance） | 查询宿舍电费余额(绑定电表) | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `campuslife electric binding get`（CampusLifeService_ElectricBinding） | 查询当前电表绑定信息 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `campuslife electric history`（CampusLifeService_ElectricHistory） | 查询近14天电费历史 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `campuslife activities get`（CampusLifeService_GetActivity） | 查询二课活动详情 | 只读 | 1 项 | activityId(path) | 可用（需授权对应 scope） |
| `campuslife activities application-requirements`（CampusLifeService_GetActivityApplicationRequirements） | 查询二课活动报名要求 | 只读 | 1 项 | activityId(path) | 可用（需授权对应 scope） |
| `campuslife activities registration get`（CampusLifeService_GetActivityRegistration） | 查询当前用户的二课活动报名状态 | 只读 | 1 项 | activityId(path) | 可用（需授权对应 scope） |
| `campuslife venues availability`（CampusLifeService_GetVenueAvailability） | 查询选定日期的可预约时段 | 只读 | 无 | venue(query)、date(query) | 公开接口，无需授权 |
| `campuslife volunteer-activities get`（CampusLifeService_GetVolunteerActivity） | 志愿活动详情 | 只读 | 无 | id(path) | 公开接口，无需授权 |
| `campuslife weather info-stream`（CampusLifeService_InfoStream） | 获取天气信息流卡片(AQI/温度/停雨) | 只读 | 无 | — | 公开接口，无需授权 |
| `campuslife activities list`（CampusLifeService_ListActivities） | 查询二课活动 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `campuslife activities notices`（CampusLifeService_ListActivityNotices） | 查询二课活动通知 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `campuslife activities organizers`（CampusLifeService_ListActivityOrganizers） | 查询二课活动主办方目录 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `campuslife electric buildings`（CampusLifeService_ListBuildings） | 查询真实楼栋列表 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `campuslife career-guide recruitment`（CampusLifeService_ListCareerRecruitment） | 查询最近三个月就业信息 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `campuslife electric floors`（CampusLifeService_ListFloors） | 按楼栋查询真实楼层列表 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `campuslife lost-found categories`（CampusLifeService_ListLostFoundCategories） | 失物类型目录 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `campuslife lost-found scenes`（CampusLifeService_ListLostFoundScenes） | 失物场所目录 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `campuslife activities mine`（CampusLifeService_ListMyActivities） | 查询我的二课活动 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `campuslife activities popular`（CampusLifeService_ListPopularActivities） | 查询热门二课活动 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `campuslife campuses`（CampusLifeService_ListPublicCampuses） | 校区列表(公开：id/名称/坐标) | 只读 | 无 | — | 公开接口，无需授权 |
| `campuslife electric rooms`（CampusLifeService_ListRooms） | 按楼层查询真实寝室与电表列表 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `campuslife venues bookable-dates`（CampusLifeService_ListVenueBookableDates） | 查询场馆可预约日期 | 只读 | 无 | venue(query) | 公开接口，无需授权 |
| `campuslife volunteer-activities list`（CampusLifeService_ListVolunteerActivities） | 志愿活动列表 | 只读 | 无 | — | 公开接口，无需授权 |
| `campuslife weather forecast`（CampusLifeService_Predict） | 获取天气预报(逐小时/逐天) | 只读 | 无 | — | 公开接口，无需授权 |
| `campuslife weather real-time`（CampusLifeService_RealTime） | 获取实时天气(按当前校区坐标) | 只读 | 无 | — | 公开接口，无需授权 |
| `campuslife lost-found items`（CampusLifeService_SearchLostItems） | 查询校园失物 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `campuslife electric binding unbind`（CampusLifeService_UnbindMeter） | 解绑当前宿舍电表 | 高风险写入 | 1 项 | — | 写操作，需显式确认 + Idempotency-Key |

### 空课表（emptyschedule）

空课表房间、收藏、成员、组队；读操作可接，组队/邀请属写操作需确认。

| 操作 | 说明 | 风险 | 权限 | 必填参数 | 结论 |
| --- | --- | --- | --- | --- | --- |
| `emptyschedule rooms create`（EmptyScheduleService_CreateRoom） | 创建空课表房间 | 写入 | 1 项 | name(body) | 写操作，需显式确认 + Idempotency-Key |
| `emptyschedule events delete`（EmptyScheduleService_DeleteEvent） | 删除排班结果 | 高风险写入 | 1 项 | room_id(query)、event_id(query) | 写操作，需显式确认 + Idempotency-Key |
| `emptyschedule favorites delete`（EmptyScheduleService_DeleteFavorite） | 删除收藏 | 高风险写入 | 1 项 | f_id(query) | 写操作，需显式确认 + Idempotency-Key |
| `emptyschedule rooms delete`（EmptyScheduleService_DeleteRoom） | 删除房间 | 高风险写入 | 1 项 | room_id(query) | 写操作，需显式确认 + Idempotency-Key |
| `emptyschedule enroll`（EmptyScheduleService_Enroll） | 口令组队报名 | 写入 | 1 项 | random_id(body)、school_year(body)、semester(body) | 写操作，需显式确认 + Idempotency-Key |
| `emptyschedule events get`（EmptyScheduleService_EventResult） | 获取排班结果详情 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `emptyschedule favorites create`（EmptyScheduleService_Favorite） | 收藏排班结果 | 写入 | 1 项 | result_id(body) | 写操作，需显式确认 + Idempotency-Key |
| `emptyschedule favorites list`（EmptyScheduleService_Favorites） | 收藏列表 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `emptyschedule gen`（EmptyScheduleService_Gen） | 口令组队生成结果 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `emptyschedule rooms generate`（EmptyScheduleService_Generate） | 计算房间共同空闲并存档 | 写入 | 1 项 | room_id(body) | 写操作，需显式确认 + Idempotency-Key |
| `emptyschedule rooms invite`（EmptyScheduleService_Invite） | 生成房间邀请码 | 写入 | 1 项 | room_id(body) | 写操作，需显式确认 + Idempotency-Key |
| `emptyschedule rooms join`（EmptyScheduleService_Join） | 通过邀请码加入房间 | 写入 | 1 项 | code(body) | 写操作，需显式确认 + Idempotency-Key |
| `emptyschedule rooms leave`（EmptyScheduleService_LeaveRoom） | 离开房间 | 写入 | 1 项 | room_id(body) | 写操作，需显式确认 + Idempotency-Key |
| `emptyschedule share`（EmptyScheduleService_LookUpShare） | 通过分享码查看排班结果 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `emptyschedule rooms list`（EmptyScheduleService_MyRooms） | 我加入的房间列表 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `emptyschedule rooms detail`（EmptyScheduleService_RoomDetail） | 房间详情 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `emptyschedule events share`（EmptyScheduleService_Share） | 分享排班结果生成分享码 | 写入 | 1 项 | event_id(body)、room_id(body) | 写操作，需显式确认 + Idempotency-Key |
| `emptyschedule status`（EmptyScheduleService_Status） | 口令组队状态查询 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `emptyschedule favorites update`（EmptyScheduleService_UpdateFavorite） | 修改收藏备注 | 写入 | 1 项 | f_id(body) | 写操作，需显式确认 + Idempotency-Key |

### 信息流与订阅（feed）

首页信息流与课表 ICS 订阅；只读。

| 操作 | 说明 | 风险 | 权限 | 必填参数 | 结论 |
| --- | --- | --- | --- | --- | --- |
| `feed`（FeedService_Feed） | 首页信息流聚合(并发) | 敏感只读 | 1 项 | — | 可用（需授权对应 scope） |
| `feed ics-link get`（FeedService_IcsLink） | 获取课表ICS订阅链接(无则新建) | 只读 | 2 项 | — | 可用（需授权对应 scope） |
| `feed ics-link revoke`（FeedService_RevokeIcsToken） | 吊销课表ICS订阅令牌 | 高风险写入 | 1 项 | — | 写操作，需显式确认 + Idempotency-Key |
| `feed ics-link rotate`（FeedService_RotateIcsToken） | 轮换课表ICS订阅令牌(返回新链接) | 写入 | 2 项 | — | 写操作，需显式确认 + Idempotency-Key |
| `feed schedule`（FeedService_ScheduleIcs） | 生成课表 iCalendar 数据 | 只读 | 无 | token(query) | 公开接口，无需授权 |

### 研究生（graduate）

研究生成绩/学籍/导师；本科生账号不适用，仅研究生绑定后可用。

| 操作 | 说明 | 风险 | 权限 | 必填参数 | 结论 |
| --- | --- | --- | --- | --- | --- |
| `graduate grades`（GraduateService_GraduateGrades） | 查询本人研究生成绩 | 敏感只读 | 1 项 | — | 本科生不适用；研究生绑定后可用 |
| `graduate info`（GraduateService_GraduateInfo） | 查询本人研究生学籍/个人信息 | 敏感只读 | 1 项 | — | 本科生不适用；研究生绑定后可用 |
| `graduate tutors`（GraduateService_GraduateTutors） | 查询本人研究生导师 | 只读 | 1 项 | — | 本科生不适用；研究生绑定后可用 |

### 群聊（groupchat）

课程群/班级群/年级群；创建/合并/同步/退出都影响他人，只留在校园页并要求确认。

| 操作 | 说明 | 风险 | 权限 | 必填参数 | 结论 |
| --- | --- | --- | --- | --- | --- |
| `groupchat courses`（GroupChatService_CourseGroups） | 我的课程群列表 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `groupchat class create`（GroupChatService_CreateClassChatGroup） | 创建班级群 | 写入 | 1 项 | class_id(body) | 写操作，需显式确认 + Idempotency-Key |
| `groupchat grade create`（GroupChatService_CreateGradeChatGroup） | 创建年级群 | 写入 | 1 项 | grade(body)、unit_id(body) | 写操作，需显式确认 + Idempotency-Key |
| `groupchat groups create`（GroupChatService_CreateGroup） | 创建钉钉群聊 | 写入 | 1 项 | name(body)、type(body) | 写操作，需显式确认 + Idempotency-Key |
| `groupchat recruit`（GroupChatService_CreateRecruitChatGroup） | 创建招新群 | 写入 | 1 项 | member_id(body) | 写操作，需显式确认 + Idempotency-Key |
| `groupchat class get`（GroupChatService_GetClassChatGroup） | 查询班级群 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `groupchat grade get`（GroupChatService_GetGradeChatGroup） | 查询年级群 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `groupchat groups member`（GroupChatService_LeaveGroup） | 退出群聊 | 高风险写入 | 1 项 | openConversationId(query) | 写操作，需显式确认 + Idempotency-Key |
| `groupchat class merge`（GroupChatService_MergeClassChatGroup） | 合并已有班级群 | 写入 | 1 项 | class_id(body)、open_conversation_id(body) | 写操作，需显式确认 + Idempotency-Key |
| `groupchat groups list`（GroupChatService_MyGroups） | 查询我创建的群聊 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `groupchat class sync`（GroupChatService_SyncClassChatGroup） | 同步班级群成员 | 写入 | 1 项 | class_id(body) | 写操作，需显式确认 + Idempotency-Key |
| `groupchat grade sync`（GroupChatService_SyncGradeChatGroup） | 同步年级群成员 | 写入 | 1 项 | grade(body)、unit_id(body) | 写操作，需显式确认 + Idempotency-Key |

### 身份（identity）

本人身份、绑定状态、校区、会话、授权应用；只读为主，设置校区/默认身份为写操作。

| 操作 | 说明 | 风险 | 权限 | 必填参数 | 结论 |
| --- | --- | --- | --- | --- | --- |
| `identity bindings`（IdentityService_Bindings） | 查询绑定列表 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `identity bindings status`（IdentityService_GetBindStatus） | 绑定状态汇总 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `identity me campus get`（IdentityService_GetMyCampus） | 查询我的当前校区 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `identity authorizations`（IdentityService_ListAuthorizedApps） | 已授权应用列表 | 敏感只读 | 1 项 | — | 可用（需授权对应 scope） |
| `identity auth sessions`（IdentityService_ListSessions） | 查询会话列表 | 敏感只读 | 1 项 | — | 可用（需授权对应 scope） |
| `identity me`（IdentityService_Me） | 获取当前用户 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `identity tokens current`（IdentityService_RevokeCurrentPAT） | 吊销当前个人访问令牌 | 高风险写入 | 无 | — | 需本人登录，无额外 scope |
| `identity me campus set`（IdentityService_SetCurrentCampus） | 设置当前所在校区 | 写入 | 1 项 | campus_id(body) | 写操作，需显式确认 + Idempotency-Key |
| `identity default-identity`（IdentityService_SetDefaultIdentity） | 设置默认主身份 | 写入 | 1 项 | identity_type(body) | 写操作，需显式确认 + Idempotency-Key |
| `identity me profile`（IdentityService_UpdateMyProfile） | 修改昵称与头像 | 写入 | 1 项 | — | 写操作，需显式确认 + Idempotency-Key |

### 知识检索（knowledge）

知识检索与快速问答；只读，适合补进校园页快捷入口。

| 操作 | 说明 | 风险 | 权限 | 必填参数 | 结论 |
| --- | --- | --- | --- | --- | --- |
| `knowledge retrieve`（KnowledgeService_KnowledgeRetrieve） | 知识检索 | 敏感只读 | 1 项 | query(body) | 可用（需授权对应 scope） |
| `knowledge service-chat`（KnowledgeService_KnowledgeServiceChat） | 快速问答 | 敏感只读 | 1 项 | query(body) | 可用（需授权对应 scope） |
| `knowledge tags`（KnowledgeService_KnowledgeTags） | 可用筛选标签 | 只读 | 1 项 | — | 可用（需授权对应 scope） |

### 图书馆选座（librarybooking）

选座：空间分类 → 可约日期 → 实时空座 → 预约/取消；写操作必须确认。

| 操作 | 说明 | 风险 | 权限 | 必填参数 | 结论 |
| --- | --- | --- | --- | --- | --- |
| `librarybooking calendar`（LibraryBookingService_BookingCalendar） | 生成图书馆预约 iCalendar 数据 | 只读 | 无 | — | 公开接口，无需授权 |
| `librarybooking ics-link get`（LibraryBookingService_CalendarLink） | 获取图书馆预约日历订阅链接 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `librarybooking bookings cancel`（LibraryBookingService_CancelBooking） | 取消选定图书馆座位预约 | 高风险写入 | 2 项 | bookingId(path) | 写操作，需显式确认 + Idempotency-Key |
| `librarybooking bookings create`（LibraryBookingService_CreateBooking） | 预约选定图书馆座位 | 高风险写入 | 2 项 | beginTime(body)、categoryId(body)、contentId(body)、date(body)、durationHours(body)、roomId(body)、seatId(body) | 写操作，需显式确认 + Idempotency-Key |
| `librarybooking options`（LibraryBookingService_GetBookingOptions） | 查询空间可预约日期和时间 | 敏感只读 | 1 项 | categoryId(query)、contentId(query) | 可用（需授权对应 scope） |
| `librarybooking bookings list`（LibraryBookingService_ListMyBookings） | 查询我的图书馆座位预约 | 敏感只读 | 1 项 | — | 可用（需授权对应 scope） |
| `librarybooking categories`（LibraryBookingService_ListSpaceCategories） | 查询图书馆座位空间分类 | 敏感只读 | 1 项 | — | 可用（需授权对应 scope） |
| `librarybooking ics-link revoke`（LibraryBookingService_RevokeCalendarLink） | 停止图书馆预约日历订阅 | 高风险写入 | 1 项 | — | 写操作，需显式确认 + Idempotency-Key |
| `librarybooking ics-link rotate`（LibraryBookingService_RotateCalendarLink） | 轮换图书馆预约日历订阅链接 | 写入 | 1 项 | — | 写操作，需显式确认 + Idempotency-Key |
| `librarybooking seats search`（LibraryBookingService_SearchAvailableSeats） | 实时查询图书馆座位 | 敏感只读 | 1 项 | categoryId(query)、contentId(query)、date(query)、beginTime(query)、durationHours(query) | 可用（需授权对应 scope） |

### 校友传话（messaging）

校友传话、黑名单、生日祝福；涉及他人消息，写操作需确认，助手默认不接。

| 操作 | 说明 | 风险 | 权限 | 必填参数 | 结论 |
| --- | --- | --- | --- | --- | --- |
| `messaging pigeons blacklist add`（MessagingService_AddBlacklist） | 添加校友传话黑名单 | 写入 | 1 项 | staffId(body) | 写操作，需显式确认 + Idempotency-Key |
| `messaging wishes base`（MessagingService_BirthdayBase） | 生日祝福首页数据 | 敏感只读 | 1 项 | — | 可用（需授权对应 scope） |
| `messaging pigeons blacklist list`（MessagingService_ListBlacklist） | 校友传话黑名单 | 敏感只读 | 1 项 | — | 可用（需授权对应 scope） |
| `messaging pigeons`（MessagingService_ListPigeons） | 校友传话收件箱或发件箱 | 敏感只读 | 1 项 | — | 可用（需授权对应 scope） |
| `messaging wishes`（MessagingService_ListWishes） | 祝福历史 | 敏感只读 | 1 项 | — | 可用（需授权对应 scope） |
| `messaging pigeons recall`（MessagingService_RecallPigeon） | 撤回24小时内的校友传话 | 写入 | 1 项 | id(query) | 写操作，需显式确认 + Idempotency-Key |
| `messaging pigeons blacklist remove`（MessagingService_RemoveBlacklist） | 移除校友传话黑名单 | 高风险写入 | 1 项 | staff-id(query) | 写操作，需显式确认 + Idempotency-Key |
| `messaging pigeons send`（MessagingService_SendPigeon） | 发送校友传话 | 写入 | 1 项 | Idempotency-Key(header)、content(body)、targetStaffId(body) | 写操作，需显式确认 + Idempotency-Key |
| `messaging wishes send`（MessagingService_SendWish） | 发送生日或节日祝福 | 写入 | 1 项 | Idempotency-Key(header)、content(body)、kind(body)、nickname(body)、targetStaffId(body) | 写操作，需显式确认 + Idempotency-Key |

### 社区动态（moments）

社区动态：帖子、评论、点赞、收藏、关注、举报；只读可接，发布/撤回/举报需确认。

| 操作 | 说明 | 风险 | 权限 | 必填参数 | 结论 |
| --- | --- | --- | --- | --- | --- |
| `moments posts collection collect`（MomentsService_CollectPost） | 收藏帖子 | 写入 | 1 项 | id(path) | 写操作，需显式确认 + Idempotency-Key |
| `moments official-accounts following follow`（MomentsService_FollowOfficialAccount） | 关注官方号 | 写入 | 1 项 | app_id(path) | 写操作，需显式确认 + Idempotency-Key |
| `moments users following follow`（MomentsService_FollowUser） | 关注用户 | 写入 | 1 项 | user_id(path) | 写操作，需显式确认 + Idempotency-Key |
| `moments feed`（MomentsService_GetFeed） | 信息流 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `moments hashtags`（MomentsService_GetHashtag） | 话题详情 | 只读 | 无 | name(path) | 公开接口，无需授权 |
| `moments me inbox unread`（MomentsService_GetMomentsInboxUnread） | 收件箱未读数 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `moments me profile`（MomentsService_GetMyProfile） | 我的社区状态 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `moments official-accounts`（MomentsService_GetOfficialAccount） | 官方号信息 | 只读 | 1 项 | app_id(path) | 可用（需授权对应 scope） |
| `moments posts get`（MomentsService_GetPost） | 帖子详情 | 只读 | 1 项 | id(path) | 可用（需授权对应 scope） |
| `moments me posting-identities`（MomentsService_GetPostingIdentities） | 可用发布身份 | 敏感只读 | 1 项 | — | 可用（需授权对应 scope） |
| `moments users`（MomentsService_GetUserProfile） | 用户主页 | 只读 | 1 项 | user_id(path) | 可用（需授权对应 scope） |
| `moments categories`（MomentsService_ListCategories） | 板块列表 | 只读 | 无 | — | 公开接口，无需授权 |
| `moments posts comments list`（MomentsService_ListComments） | 一级评论列表 | 只读 | 1 项 | id(path) | 可用（需授权对应 scope） |
| `moments emojis`（MomentsService_ListEmojis） | 可用表情集合 | 只读 | 无 | — | 公开接口，无需授权 |
| `moments users followers`（MomentsService_ListFollowers） | 粉丝列表 | 只读 | 1 项 | user_id(path) | 可用（需授权对应 scope） |
| `moments users followings`（MomentsService_ListFollowings） | 关注列表 | 只读 | 1 项 | user_id(path) | 可用（需授权对应 scope） |
| `moments me inbox likes`（MomentsService_ListMomentsInboxLikes） | 赞和收藏清单 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `moments me inbox mentions`（MomentsService_ListMomentsInboxMentions） | @和评论清单 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `moments me collections`（MomentsService_ListMyCollections） | 我的收藏 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `moments me comment-reactions`（MomentsService_ListMyCommentReactions） | 我表情回复过的评论 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `moments me mutuals`（MomentsService_ListMyMutuals） | 我的互关 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `moments me posts`（MomentsService_ListMyPosts） | 我的帖子 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `moments me reactions`（MomentsService_ListMyReactions） | 我表情回复过的帖子 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `moments official-accounts posts`（MomentsService_ListOfficialAccountPosts） | 官方号主页帖子 | 只读 | 1 项 | app_id(path) | 可用（需授权对应 scope） |
| `moments comments replies list`（MomentsService_ListReplies） | 二级评论列表 | 只读 | 1 项 | id(path) | 可用（需授权对应 scope） |
| `moments report-reasons`（MomentsService_ListReportReasons） | 举报原因枚举 | 只读 | 无 | — | 公开接口，无需授权 |
| `moments users posts`（MomentsService_ListUserPosts） | 用户主页帖子 | 只读 | 1 项 | user_id(path) | 可用（需授权对应 scope） |
| `moments me inbox read`（MomentsService_MarkMomentsInboxRead） | 标记收件箱已读 | 写入 | 1 项 | — | 写操作，需显式确认 + Idempotency-Key |
| `moments posts comments publish`（MomentsService_PublishComment） | 发布一级评论 | 写入 | 1 项 | id(path)、content(body) | 写操作，需显式确认 + Idempotency-Key |
| `moments posts publish`（MomentsService_PublishPost） | 发布帖子 | 写入 | 1 项 | content(body) | 写操作，需显式确认 + Idempotency-Key |
| `moments comments replies publish`（MomentsService_PublishReply） | 回复评论 | 写入 | 1 项 | id(path)、content(body) | 写操作，需显式确认 + Idempotency-Key |
| `moments comments reactions react`（MomentsService_ReactComment） | 为评论添加表情回复 | 写入 | 1 项 | id(path)、type(body) | 写操作，需显式确认 + Idempotency-Key |
| `moments posts reactions react`（MomentsService_ReactPost） | 为帖子添加表情回复 | 写入 | 1 项 | id(path)、type(body) | 写操作，需显式确认 + Idempotency-Key |
| `moments search`（MomentsService_Search） | 搜索 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `moments posts share`（MomentsService_SharePost） | 上报分享 | 写入 | 1 项 | id(path) | 写操作，需显式确认 + Idempotency-Key |
| `moments appeals`（MomentsService_SubmitAppeal） | 提交申诉 | 写入 | 1 项 | reason(body)、target_kind(body) | 写操作，需显式确认 + Idempotency-Key |
| `moments reports`（MomentsService_SubmitReport） | 提交举报 | 写入 | 1 项 | reason(body)、target_id(body)、target_kind(body) | 写操作，需显式确认 + Idempotency-Key |
| `moments hashtags suggest`（MomentsService_SuggestHashtags） | 话题补全 | 只读 | 无 | — | 公开接口，无需授权 |
| `moments posts collection uncollect`（MomentsService_UncollectPost） | 取消收藏 | 高风险写入 | 1 项 | id(path) | 写操作，需显式确认 + Idempotency-Key |
| `moments official-accounts following unfollow`（MomentsService_UnfollowOfficialAccount） | 取消关注官方号 | 高风险写入 | 1 项 | app_id(path) | 写操作，需显式确认 + Idempotency-Key |
| `moments users following unfollow`（MomentsService_UnfollowUser） | 取消关注用户 | 高风险写入 | 1 项 | user_id(path) | 写操作，需显式确认 + Idempotency-Key |
| `moments comments reactions unreact`（MomentsService_UnreactComment） | 取消评论表情回复 | 高风险写入 | 1 项 | id(path) | 写操作，需显式确认 + Idempotency-Key |
| `moments posts reactions unreact`（MomentsService_UnreactPost） | 取消帖子表情回复 | 高风险写入 | 1 项 | id(path) | 写操作，需显式确认 + Idempotency-Key |
| `moments posts update`（MomentsService_UpdatePost） | 编辑本人帖子 | 写入 | 1 项 | id(path)、content(body) | 写操作，需显式确认 + Idempotency-Key |
| `moments comments`（MomentsService_WithdrawComment） | 撤回本人评论 | 高风险写入 | 1 项 | id(path) | 写操作，需显式确认 + Idempotency-Key |
| `moments posts withdraw`（MomentsService_WithdrawPost） | 撤回本人帖子 | 高风险写入 | 1 项 | id(path) | 写操作，需显式确认 + Idempotency-Key |

### 提醒与阳光长跑（reminder）

提醒订阅、通知渠道偏好、阳光长跑；只读可接，订阅/退订需确认。

| 操作 | 说明 | 风险 | 权限 | 必填参数 | 结论 |
| --- | --- | --- | --- | --- | --- |
| `reminder delivery-preferences`（ReminderService_BatchSetDeliveryPreferences） | 批量设置订阅通知渠道偏好 | 写入 | 无 | updates(body) | 需本人登录，无额外 scope |
| `reminder delivery-preference get`（ReminderService_GetDeliveryPreference） | 查询订阅通知渠道偏好 | 只读 | 无 | channel(path) | 需本人登录，无额外 scope |
| `reminder list`（ReminderService_ListSubscriptions） | 获取全部提醒渠道订阅状态 | 只读 | 1 项 | — | 可用（需授权对应 scope） |
| `reminder delivery-preference reset`（ReminderService_ResetDeliveryPreference） | 恢复订阅通知系统默认 | 高风险写入 | 无 | channel(path) | 需本人登录，无额外 scope |
| `reminder delivery-preference set`（ReminderService_SetDeliveryPreference） | 设置订阅通知渠道偏好 | 写入 | 无 | channel(path)、provider(body) | 需本人登录，无额外 scope |
| `reminder subscribe`（ReminderService_SubscribeReminder） | 订阅提醒 | 写入 | 1 项 | channel(query)、channel(body) | 写操作，需显式确认 + Idempotency-Key |
| `reminder sunrun detail`（ReminderService_SunrunDetail） | 阳光长跑跑步记录 | 敏感只读 | 1 项 | — | 可用（需授权对应 scope） |
| `reminder sunrun group`（ReminderService_SunrunGroup） | 阳光长跑达标要求 | 敏感只读 | 1 项 | — | 可用（需授权对应 scope） |
| `reminder sunrun overview`（ReminderService_SunrunOverview） | 阳光长跑成绩概览 | 敏感只读 | 1 项 | — | 可用（需授权对应 scope） |
| `reminder unsubscribe`（ReminderService_UnsubscribeReminder） | 退订提醒 | 高风险写入 | 1 项 | id(query) | 写操作，需显式确认 + Idempotency-Key |
| `reminder update`（ReminderService_UpdateReminder） | 更新提醒参数 | 写入 | 1 项 | id(query) | 写操作，需显式确认 + Idempotency-Key |

### 文件上传（upload）

上传签名与续签；属于文件流程内部能力，页面不直接暴露。

| 操作 | 说明 | 风险 | 权限 | 必填参数 | 结论 |
| --- | --- | --- | --- | --- | --- |
| `upload urls`（UploadService_RenewUploadURLs） | 续签文件地址 | 写入 | 1 项 | keys(body) | 文件流程内部能力，页面不直接暴露 |
| `upload sign`（UploadService_SignUpload） | 签发直传表单 | 写入 | 1 项 | content_type(body)、filename(body)、size(body) | 文件流程内部能力，页面不直接暴露 |

## 高频域接入建议

| 域 | 校园页快捷入口（已有） | 建议补充 | 助手是否接入 |
| --- | --- | --- | --- |
| 教务 | 已覆盖：AcademicService_ScheduleNow（今明课程）、AcademicService_StudentExam（考试） | AcademicService_StudentGrade（成绩与绩点）、AcademicService_ListChaoxingHomework（学习通作业） | 现有 7 个 campus_* 工具覆盖基础查询 |
| 长期记忆 | — | — | 页面入口即可 |
| 校园生活 | 已覆盖：CampusLifeService_CardBalance（校园卡余额）、CampusLifeService_CardConsume（消费流水） | CampusLifeService_ElectricBalance（宿舍电费）、CampusLifeService_ListMyActivities（我的二课） | 现有 7 个 campus_* 工具覆盖基础查询 |
| 空课表 | 已覆盖：EmptyScheduleService_MyRooms（我的房间）、EmptyScheduleService_Favorites（收藏排班） | — | 页面入口即可 |
| 信息流与订阅 | 已覆盖：FeedService_Feed（信息流）、FeedService_IcsLink（课表订阅） | — | 页面入口即可 |
| 研究生 | — | — | 页面入口即可 |
| 群聊 | — | — | 写操作影响他人，留在页面 |
| 身份 | 已覆盖：IdentityService_Me（我的身份）、IdentityService_GetBindStatus（绑定状态） | IdentityService_GetMyCampus（校区） | 页面入口即可 |
| 知识检索 | 已覆盖：KnowledgeService_KnowledgeRetrieve（知识检索）、KnowledgeService_KnowledgeServiceChat（快速问答） | — | 页面入口即可 |
| 图书馆选座 | 已覆盖：LibraryBookingService_ListSpaceCategories（空间）、LibraryBookingService_SearchAvailableSeats（实时空座） | LibraryBookingService_CreateBooking（预约，写） | 只读查询可接，预约需确认 |
| 校友传话 | — | — | 写操作影响他人，留在页面 |
| 社区动态 | 已覆盖：MomentsService_ListMyPosts（我的帖子）、MomentsService_ListMyCollections（我的收藏） | — | 写操作影响他人，留在页面 |
| 提醒与阳光长跑 | 已覆盖：ReminderService_SunrunOverview（阳光长跑）、ReminderService_ListSubscriptions（提醒订阅） | — | 页面入口即可 |
| 文件上传 | — | — | 页面入口即可 |

## 缺口与边界

1. **199 个操作不都在页面上出现**：校园页只给高频域做快捷入口，其余在「全部」里搜索；不建议把 199 个操作全塞进助手，会挤爆小模型的工具表。
2. **写操作统一走确认**：`write` 需要勾选确认，`high-risk-write` 还要输入「确认执行」；请求带 `Idempotency-Key`，缺权限返回 `missing_scope` 并提供补充授权入口。
3. **研究生域不适用于本科生**：`graduate` 的 3 个操作只在绑定研究生身份后可用，本科生页面不置顶。
4. **文件上传不直接暴露**：`upload` 只用于社区头像/图片等内部流程。
5. **真实可用性待实测**：校园代理依赖 `api.hduhelp.com` 与用户 PAT；未授权时只验证了鉴权路径与错误格式，没有逐项调用上游。

## 生成命令

```bash
node tools/campus-inventory.mjs
```

生成脚本：`tools/campus-inventory.mjs`。
