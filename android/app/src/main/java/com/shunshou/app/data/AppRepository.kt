package com.shunshou.app.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.UUID

data class AppUiState(
    val signedIn: Boolean = false,
    val username: String = "",
    val ledger: LedgerState = LedgerState.EMPTY,
    val planner: PlannerSnapshot = PlannerSnapshot.EMPTY,
    val ledgerUpdatedAt: String? = null,
    val loading: Boolean = false,
    val message: String? = null,
    val error: String? = null,
)

class AppRepository(
    private val api: ShunshouApi,
    private val store: SessionStore,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow(restore())
    val state: StateFlow<AppUiState> = _state.asStateFlow()
    private val deviceId = store.deviceId()

    private fun restore(): AppUiState {
        val ledger = store.cached("ledger")
            ?.let { runCatching { Models.parseLedger(JSONObject(it)) }.getOrNull() }
            ?: LedgerState.EMPTY
        val planner = store.cached("planner")
            ?.let { runCatching { Models.parsePlanner(JSONObject(it)) }.getOrNull() }
            ?: PlannerSnapshot.EMPTY
        return AppUiState(
            signedIn = store.isValid(),
            username = store.load()?.username.orEmpty(),
            ledger = ledger,
            planner = planner,
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
                store.cache("ledger", JSONObject().put("ledger", Models.ledgerJson(ledger)).toString())
                store.cache("planner", Models.plannerJson(planner).toString())
                _state.value = _state.value.copy(
                    ledger = ledger, planner = planner, ledgerUpdatedAt = updatedAt,
                    loading = false, error = null,
                )
            } catch (error: ApiException) {
                if (error.status == 401) expireSession()
                else _state.value = _state.value.copy(loading = false, error = ApiErrors.message(error))
            }
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
        val token = token() ?: return
        // baseUpdatedAt 必须在启动协程前同步读取：协程调度后别的写操作可能已经推进了这个值。
        val baseUpdatedAt = _state.value.ledgerUpdatedAt
        scope.launch(Dispatchers.IO) {
            try {
                val updatedAt = api.putLedger(token, next, baseUpdatedAt)
                _state.value = _state.value.copy(ledgerUpdatedAt = updatedAt)
            } catch (error: ApiException) {
                if (error.status == 409) {
                    _state.value = _state.value.copy(ledger = previous, error = "数据在别处更新了，已为你刷新。")
                    refresh()
                } else {
                    _state.value = _state.value.copy(ledger = previous, error = ApiErrors.message(error))
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
        val token = token() ?: return
        val revision = _state.value.planner.revision
        scope.launch(Dispatchers.IO) {
            try {
                val updated = api.plannerOperation(token, UUID.randomUUID().toString(), revision, command)
                store.cache("planner", Models.plannerJson(updated).toString())
                _state.value = _state.value.copy(planner = updated)
            } catch (error: ApiException) {
                if (error.status == 409) {
                    _state.value = _state.value.copy(error = "数据在别处更新了，已为你刷新。")
                    refresh()
                } else {
                    _state.value = _state.value.copy(error = ApiErrors.message(error))
                }
            }
        }
    }

    private fun expireSession() {
        store.clear()
        _state.value = AppUiState(signedIn = false)
    }
}
