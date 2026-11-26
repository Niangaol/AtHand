package com.shunshou.app.data

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.util.UUID

data class AppUiState(
    val signedIn: Boolean = false,
    val username: String = "",
    val ledger: LedgerState = LedgerState.EMPTY,
    val planner: PlannerSnapshot = PlannerSnapshot.EMPTY,
    val calendar: CalendarState = CalendarState(),
    val ledgerUpdatedAt: String? = null,
    val loading: Boolean = false,
    val calendarLoading: Boolean = false,
    val message: String? = null,
    val error: String? = null,
) {
    fun allEvents(): List<PlannerEvent> =
        (planner.events + calendar.sources.filter { it.calendarAvailable }.flatMap { it.events })
            .distinctBy { it.id }
            .sortedBy { it.start }
}

class AppRepository(
    private val api: ShunshouApi,
    private val store: SessionStore,
    private val context: Context,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow(restore())
    val state: StateFlow<AppUiState> = _state.asStateFlow()
    private val deviceId = store.deviceId()

    // 账本与专注的写操作各一把互斥锁：保证同一时刻只有一个 PUT / 命令在飞，
    // 否则快速连记两笔会带着同一个 baseUpdatedAt 打到服务端，第二笔必然 409。
    private val ledgerWrite = Mutex()
    private val plannerWrite = Mutex()

    private fun restore(): AppUiState {
        val ledger = store.cached("ledger")
            ?.let { runCatching { Models.parseLedger(JSONObject(it)) }.getOrNull() }
            ?: LedgerState.EMPTY
        val planner = store.cached("planner")
            ?.let { runCatching { Models.parsePlanner(JSONObject(it)) }.getOrNull() }
            ?: PlannerSnapshot.EMPTY
        val calendar = store.cached("calendar")
            ?.let { runCatching { Models.parseCalendarState(JSONObject(it)) }.getOrNull() }
            ?: CalendarState()
        return AppUiState(
            signedIn = store.isValid(),
            username = store.load()?.username.orEmpty(),
            ledger = ledger,
            planner = planner,
            calendar = calendar,
            ledgerUpdatedAt = store.cached("ledgerUpdatedAt"),
        )
    }

    private fun token(): String? = store.load()?.takeIf { store.isValid() }?.token

    fun clearMessage() {
        _state.value = _state.value.copy(message = null, error = null)
    }

    fun refresh() {
        val token = token() ?: return
        _state.value = _state.value.copy(loading = true)
        scope.launch(Dispatchers.IO) {
            try {
                val (ledger, updatedAt) = api.fetchLedger(token)
                val planner = api.fetchPlanner(token)
                val calendarSources = api.fetchCalendar(token)
                val calendar = CalendarState(
                    sources = calendarSources,
                    status = _state.value.calendar.status,
                    lastSuccess = _state.value.calendar.lastSuccess,
                )
                store.cache("ledger", JSONObject().put("ledger", Models.ledgerJson(ledger)).toString())
                store.cache("ledgerUpdatedAt", updatedAt.orEmpty())
                store.cache("planner", Models.plannerJson(planner).toString())
                store.cache("calendar", Models.calendarStateJson(calendar).toString())
                _state.value = _state.value.copy(
                    ledger = ledger, planner = planner, calendar = calendar, ledgerUpdatedAt = updatedAt,
                    loading = false, error = null,
                )
            } catch (error: ApiException) {
                if (error.status == 401) expireSession()
                else _state.value = _state.value.copy(loading = false, error = ApiErrors.message(error))
            }
        }
    }

    fun syncCalendar() {
        val session = store.load()?.takeIf { store.isValid() }
        if (session == null) {
            _state.value = _state.value.copy(error = "登录已失效，请重新登录。")
            return
        }
        if (_state.value.calendarLoading) return
        _state.value = _state.value.copy(calendarLoading = true, error = null)
        scope.launch(Dispatchers.IO) {
            val result = CloudCalendarSync.sync(context, store, ShunshouApi(session.baseUrl), force = true)
            if (result.unauthorized) expireSession()
            _state.value = _state.value.copy(
                calendar = result.state ?: _state.value.calendar,
                calendarLoading = false,
                message = if (result.success) result.message else null,
                error = if (result.success) null else result.message,
            )
        }
    }

    fun signIn(username: String, password: String, register: Boolean) {
        _state.value = _state.value.copy(loading = true, error = null)
        scope.launch(Dispatchers.IO) {
            try {
                val result = if (register) api.register(username, password) else api.login(username, password)
                store.save(Session(api.baseUrl, result.token, result.expiresAt, result.user.username))
                _state.value = _state.value.copy(
                    signedIn = true, username = result.user.username, loading = false,
                )
                refresh()
            } catch (error: ApiException) {
                _state.value = _state.value.copy(loading = false, error = ApiErrors.message(error))
            }
        }
    }

    fun signOut() {
        val token = token()
        if (token != null) scope.launch(Dispatchers.IO) { api.logout(token) }
        store.clear()
        _state.value = AppUiState(signedIn = false)
    }

    fun addRecord(record: RecordEntry) {
        val current = _state.value.ledger
        val next = current.copy(records = current.records + record)
        _state.value = _state.value.copy(ledger = next, message = "已记一笔")
        persistLedger(current, next)
    }

    fun deleteRecord(id: String) {
        val current = _state.value.ledger
        val next = current.copy(records = current.records.filter { it.id != id })
        _state.value = _state.value.copy(ledger = next, message = "已删除")
        persistLedger(current, next)
    }

    private fun persistLedger(previous: LedgerState, next: LedgerState) {
        val token = token()
        if (token == null) {
            // 没有会话就写不出去，回退乐观更新，别让界面假装成功。
            _state.value = _state.value.copy(ledger = previous, error = "登录已失效，请重新登录后再记。")
            return
        }
        // 写回前自检：网页端会整份拒收不合规账本，宁可在手机上先拦住。
        val problems = Models.ledgerProblems(next)
        if (problems.isNotEmpty()) {
            _state.value = _state.value.copy(ledger = previous, error = problems.first())
            return
        }
        scope.launch(Dispatchers.IO) {
            // 同一时刻只允许一个 PUT 在飞：否则两笔快速连记会带着同一个 baseUpdatedAt
            // 打到服务端，后一笔必然 409，而它的回滚会把前一笔已成功的记录一起抹掉。
            ledgerWrite.withLock {
                // baseUpdatedAt 必须在锁内、紧邻 PUT 之前读取。放在锁外（或 launch 之前）读，
                // 排队期间前一笔写已经把版本推进了，本笔就会拿着过期版本撞 409。
                val baseUpdatedAt = _state.value.ledgerUpdatedAt?.takeIf { it.isNotBlank() }
                try {
                    val updatedAt = api.putLedger(token, next, baseUpdatedAt)
                    store.cache("ledgerUpdatedAt", updatedAt)
                    _state.value = _state.value.copy(ledgerUpdatedAt = updatedAt)
                } catch (error: ApiException) {
                    // 只有当前内存状态仍是我们乐观写入的那一份才回滚。否则说明后续写已经在这个
                    // 基础上继续前进，回滚会连带抹掉它们的成果——此时只报错/刷新，不动本地数据。
                    val stillOurs = _state.value.ledger == next
                    if (stillOurs) _state.value = _state.value.copy(ledger = previous)
                    if (error.status == 401) {
                        expireSession()
                        _state.value = _state.value.copy(error = "登录已失效，请重新登录。")
                    } else if (error.status == 409) {
                        _state.value = _state.value.copy(error = "数据在别处更新了，已为你刷新。")
                        refresh()
                    } else {
                        _state.value = _state.value.copy(error = ApiErrors.message(error))
                    }
                }
            }
        }
    }

    fun startFocus(task: String, minutes: Int) {
        val command = JSONObject()
            .put("kind", "focus.start")
            .put("id", "focus-${UUID.randomUUID()}")
            .put("task", task)
            .put("minutes", minutes)
            .put("owner", deviceId)
        plannerCall(command)
    }

    fun controlFocus(action: String) {
        val active = _state.value.planner.focusSessions
            .firstOrNull { it.status == "running" || it.status == "paused" } ?: return
        val command = JSONObject()
            .put("kind", "focus.control")
            .put("id", active.id)
            .put("action", action)
            .put("owner", deviceId)
            .put("epoch", active.epoch)
        plannerCall(command)
    }

    private fun plannerCall(command: JSONObject) {
        val token = token()
        if (token == null) {
            _state.value = _state.value.copy(error = "登录已失效，请重新登录。")
            return
        }
        scope.launch(Dispatchers.IO) {
            plannerWrite.withLock {
                // revision 同样必须在锁内紧邻请求之前读取，排队期间前一条命令可能已推进它。
                val revision = _state.value.planner.revision
                try {
                    val updated = api.plannerOperation(token, UUID.randomUUID().toString(), revision, command)
                    store.cache("planner", Models.plannerJson(updated).toString())
                    _state.value = _state.value.copy(planner = updated)
                } catch (error: ApiException) {
                    // 命令被服务端拒绝时本地 planner 从未改过，不需要回滚，只报错并刷新。
                    if (error.status == 401) {
                        expireSession()
                        _state.value = _state.value.copy(error = "登录已失效，请重新登录。")
                    } else if (error.status == 409) {
                        _state.value = _state.value.copy(error = "数据在别处更新了，已为你刷新。")
                        refresh()
                    } else {
                        _state.value = _state.value.copy(error = ApiErrors.message(error))
                    }
                }
            }
        }
    }

    private fun expireSession() {
        store.clear()
        _state.value = AppUiState(signedIn = false)
    }
}
