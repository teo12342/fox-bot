package app.foxbot

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.compose.runtime.*
import org.json.JSONArray
import org.json.JSONObject

object ConnectionHolder { var client: RemoteClient? = null }
class FoxModel(app: Application) : AndroidViewModel(app) {
    var status by mutableStateOf("Scan the QR code shown by Fox Bot on your PC")
    var snapshot by mutableStateOf(JSONObject())
    var error by mutableStateOf<String?>(null)
    var selectedConversation by mutableStateOf<String?>(null)
    var artifact by mutableStateOf<JSONObject?>(null)
    var uploadedAttachments by mutableStateOf<List<JSONObject>>(emptyList())
    var sentConversation by mutableStateOf<Pair<String, Long>?>(null)
    private val pendingMessages = java.util.concurrent.ConcurrentHashMap<String, String>()
    private val pending = java.util.concurrent.ConcurrentHashMap<String, String>()
    lateinit var remote: RemoteClient
        private set
    init { remote = RemoteClient(app, { text -> android.os.Handler(app.mainLooper).post { status = text } }, { event ->
        android.os.Handler(app.mainLooper).post {
            when (event.optString("type")) {
                "snapshot" -> snapshot = event.getJSONObject("snapshot")
                "result" -> {
                    val result = event.getJSONObject("result")
                    val commandType = pending.remove(result.optString("id"))
                    val conversation = pendingMessages.remove(result.optString("id"))
                    if (!result.optBoolean("ok")) error = result.optJSONObject("error")?.optString("message", "Command failed")
                    else {
                        if(conversation != null) { saveDraft(conversation, ""); uploadedAttachments = emptyList(); sentConversation = conversation to System.currentTimeMillis() }
                        val data = result.optJSONObject("data")
                        if (data?.has("bots") == true && data.has("seq")) snapshot = data
                        else if(commandType == "artifact.read" && data != null) artifact = data
                        else if(commandType == "attachment.upload" && data != null) uploadedAttachments = uploadedAttachments + data
                        else runCatching { remote.command("snapshot", JSONObject()) }
                    }
                }
                "event" -> runCatching { remote.command("snapshot", JSONObject()) }
            }
        }
    }).also { ConnectionHolder.client = it } }
    fun list(name: String): List<JSONObject> = snapshot.optJSONArray(name)?.let { a -> (0 until a.length()).map { a.getJSONObject(it) } } ?: emptyList()
    fun command(type: String, payload: JSONObject) { runCatching { pending[remote.command(type, payload)] = type }.onFailure { error = it.message } }
    fun sendMessage(conversationId: String, text: String) {
        runCatching {
            val id = remote.command("message.send", JSONObject().put("conversationId", conversationId).put("content", text).put("attachments", JSONArray(uploadedAttachments)))
            pending[id] = "message.send"; pendingMessages[id] = conversationId
        }.onFailure { error = it.message }
    }
    fun pair(raw: String) { runCatching { remote.pair(raw) }.onFailure { error = it.message } }
    fun draft(id: String) = getApplication<Application>().getSharedPreferences("drafts", 0).getString(id, "") ?: ""
    fun saveDraft(id: String, text: String) { getApplication<Application>().getSharedPreferences("drafts", 0).edit().putString(id, text).apply() }
}
