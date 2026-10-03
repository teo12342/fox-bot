package app.foxbot

import android.content.Intent
import android.os.Bundle
import android.speech.RecognizerIntent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectTapGestures
import org.webrtc.SurfaceViewRenderer
import androidx.lifecycle.viewmodel.compose.viewModel
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import org.json.JSONArray
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) { super.onCreate(savedInstanceState); setContent {
        MaterialTheme(colorScheme = darkColorScheme(primary = Color(0xFFFF8534), background = Color(0xFF101112), surface = Color(0xFF1B1D20))) { FoxScreen(this) }
    } }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun FoxScreen(activity: MainActivity, model: FoxModel = viewModel()) {
    var tab by remember { mutableStateOf("Bots") }
    var editor by remember { mutableStateOf<JSONObject?>(null) }
    var editorType by remember { mutableStateOf("bot") }
    var pastedCode by remember { mutableStateOf("") }
    var background by remember { mutableStateOf(false) }
    val saveArtifact = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val data = model.artifact
        if(uri != null && data != null) runCatching { activity.contentResolver.openOutputStream(uri)?.use { it.write(android.util.Base64.decode(data.getString("base64"), android.util.Base64.DEFAULT)) } }.onFailure { model.error = it.message }
        model.artifact = null
    }
    val notifyPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    Scaffold(topBar = { TopAppBar(title = { Text("🦊 Fox Bot") }, actions = {
        TextButton(onClick = { model.remote.reconnect() }) { Text("Reconnect") }
        TextButton(onClick = { model.command("emergency.stop", JSONObject()) }) { Text("Stop") }
    }) }, bottomBar = { NavigationBar { listOf("Bots", "Chat", "Workflows", "Approvals", "Settings").forEach { name -> NavigationBarItem(selected = name == tab, onClick = { tab = name }, icon = { Text(when(name) { "Bots" -> "◈"; "Chat" -> "◇"; "Workflows" -> "↻"; "Approvals" -> "✓"; else -> "⚙" }) }, label = { Text(name) }) } } }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(model.status, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            when (tab) {
                "Bots" -> {
                    Button(onClick = { editorType = "bot"; editor = JSONObject() }, enabled = model.remote.connected) { Text("Create a bot") }
                    LazyColumn { items(model.list("bots").filter { !it.optBoolean("hidden") }, key = { it.getString("id") }) { bot ->
                        Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) { Column(Modifier.padding(12.dp)) {
                            Text("${bot.optString("avatar", "🦊")} ${bot.getString("name")}", style = MaterialTheme.typography.titleMedium)
                            Text(bot.optString("role")); Text(bot.optString("model"), style = MaterialTheme.typography.labelSmall)
                            Row { TextButton(onClick = { val convo = model.list("conversations").firstOrNull { c -> c.optJSONArray("botIds")?.toString()?.contains(bot.getString("id")) == true }; if (convo != null) model.selectedConversation = convo.getString("id") else model.command("conversation.create", JSONObject().put("title", bot.getString("name")).put("botIds", JSONArray().put(bot.getString("id")))); tab = "Chat" }) { Text("Chat") }
                                TextButton(onClick = { editorType = "bot"; editor = JSONObject(bot.toString()) }) { Text("Edit") }
                                TextButton(onClick = { model.command("bot.duplicate", JSONObject().put("id", bot.getString("id"))) }) { Text("Duplicate") }
                            }
                            Row { TextButton(onClick = { model.command("bot.update", JSONObject().put("id", bot.getString("id")).put("revision", bot.getInt("revision")).put("pinned", !bot.optBoolean("pinned"))) }) { Text(if(bot.optBoolean("pinned")) "Unpin" else "Pin") }
                                TextButton(onClick = { model.command("bot.update", JSONObject().put("id", bot.getString("id")).put("revision", bot.getInt("revision")).put("hidden", true)) }) { Text("Hide") }
                                TextButton(onClick = { editorType = "memory"; editor = JSONObject().put("botId", bot.getString("id")) }) { Text("Remember") }
                            }
                        } }
                    } }
                }
                "Chat" -> ChatPane(model)
                "Workflows" -> {
                    Row { Button(onClick = { editorType = "skill"; editor = JSONObject() }, enabled = model.remote.connected) { Text("New skill") }; Spacer(Modifier.width(8.dp)); Button(onClick = { editorType = "routine"; editor = JSONObject().put("botId", model.list("bots").firstOrNull()?.optString("id") ?: "") }, enabled = model.remote.connected) { Text("New routine") } }
                    LazyColumn { items(model.list("skills") + model.list("routines")) { entry -> val type = if(entry.has("cron")) "routine" else "skill"
                        Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) { Column(Modifier.padding(12.dp)) { Text(entry.optString("name")); Text(if (type == "routine") "${entry.optString("cron")} · ${entry.optString("timezone")} · ${if(entry.optBoolean("enabled")) "Active" else "Paused"}" else entry.optString("description")); Row {
                            TextButton(onClick = { editorType = type; editor = JSONObject(entry.toString()) }) { Text("Edit") }
                            if(type == "routine") TextButton(onClick = { model.command("routine.save", JSONObject(entry.toString()).put("enabled", !entry.optBoolean("enabled"))) }) { Text("Pause / resume") }
                            TextButton(onClick = { model.command("$type.delete", JSONObject().put("id", entry.getString("id"))) }) { Text("Delete") }
                        } } }
                    } }
                }
                "Approvals" -> LazyColumn { items(model.list("approvals").filter { it.optString("status") == "pending" }) { approval ->
                    Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) { Column(Modifier.padding(12.dp)) { Text(approval.optString("summary")); Row { Button(onClick = { model.command("approval.resolve", JSONObject().put("id", approval.getString("id")).put("approved", true)) }, enabled = model.remote.connected) { Text("Approve") }; TextButton(onClick = { model.command("approval.resolve", JSONObject().put("id", approval.getString("id")).put("approved", false)) }, enabled = model.remote.connected) { Text("Reject") } } } }
                } }
                "Settings" -> {
                    Text("Pair with your PC", style = MaterialTheme.typography.headlineSmall)
                    Button(onClick = { GmsBarcodeScanning.getClient(activity).startScan().addOnSuccessListener { barcode -> barcode.rawValue?.let(model::pair) }.addOnFailureListener { model.error = it.message } }) { Text("Scan pairing QR") }
                    OutlinedTextField(pastedCode, { pastedCode = it }, label = { Text("Or paste QR contents") }, modifier = Modifier.fillMaxWidth(), maxLines = 3)
                    Button(onClick = { model.pair(pastedCode); pastedCode = "" }) { Text("Pair") }
                    if(model.remote.verification.isNotEmpty()) Text("Compare on PC: ${model.remote.verification}")
                    Row { Switch(background, { enabled -> background = enabled; if(enabled) { if(android.os.Build.VERSION.SDK_INT >= 33) notifyPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS); activity.startForegroundService(Intent(activity, ConnectionService::class.java)) } else activity.stopService(Intent(activity, ConnectionService::class.java)) }); Text("Keep connection in background", Modifier.padding(top = 12.dp)) }
                    Text("Your PC must stay awake. No model keys leave the PC. Disconnected drafts stay on this phone.")
                    TextButton(onClick = { model.remote.forget() }) { Text("Forget PC") }
                    TextButton(onClick = { tab = "Results" }) { Text("View results and files") }
                    TextButton(onClick = { tab = "Computer" }) { Text("View PC computer") }
                    TextButton(onClick = { tab = "Memory" }) { Text("Manage memories") }
                    model.list("bots").filter { it.optBoolean("hidden") }.forEach { bot -> TextButton(onClick = { model.command("bot.update", JSONObject().put("id", bot.getString("id")).put("revision", bot.getInt("revision")).put("hidden", false)) }) { Text("Show ${bot.optString("name")}") } }
                }
                "Results" -> LazyColumn { items(model.list("artifacts")) { artifact -> Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) { Column(Modifier.padding(12.dp)) { Text(artifact.optString("name")); Text("${artifact.optString("mime")} · ${artifact.optLong("size")} bytes"); TextButton(onClick = { model.command("artifact.read", JSONObject().put("id", artifact.getString("id"))) }) { Text("Retrieve") } } } } }
                "Computer" -> ComputerPane(model)
                "Memory" -> LazyColumn { items(model.list("memories")) { memory -> Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) { Column(Modifier.padding(12.dp)) { Text(memory.optString("text")); Row {
                    Switch(memory.optBoolean("enabled"), { value -> model.command("memory.save", JSONObject(memory.toString()).put("enabled", value)) }, enabled = model.remote.connected)
                    TextButton(onClick = { editorType = "memory"; editor = JSONObject(memory.toString()) }) { Text("Edit") }
                    TextButton(onClick = { model.command("memory.delete", JSONObject().put("id", memory.getString("id"))) }) { Text("Delete") }
                } } } } }
            }
        }
    }
    model.error?.let { message -> AlertDialog(onDismissRequest = { model.error = null }, title = { Text("Fox Bot") }, text = { Text(message) }, confirmButton = { TextButton(onClick = { model.error = null }) { Text("OK") } }) }
    model.artifact?.let { artifact -> AlertDialog(onDismissRequest = { model.artifact = null }, title = { Text(artifact.optString("name")) }, text = { Text("Save this result from your PC to this phone?") }, confirmButton = { TextButton(onClick = { saveArtifact.launch(artifact.optString("name", "result")) }) { Text("Save file") } }, dismissButton = { TextButton(onClick = { model.artifact = null }) { Text("Close") } }) }
    editor?.let { entry -> EntityEditor(editorType, entry, model, onDismiss = { editor = null }) }
}

@Composable fun ComputerPane(model: FoxModel) {
    var takeover by remember { mutableStateOf(false) }
    var input by remember { mutableStateOf("") }
    val track = model.remote.videoTrack
    if(track == null) Text("The PC has not shared a computer stream. Start computer sharing on the PC.")
    else AndroidView(factory = { context -> SurfaceViewRenderer(context).apply { init(model.remote.egl.eglBaseContext, null); track.addSink(this) } }, onRelease = { renderer -> track.removeSink(renderer); renderer.release() }, modifier = Modifier.fillMaxWidth().aspectRatio(model.remote.videoWidth.toFloat() / model.remote.videoHeight).pointerInput(takeover) { detectTapGestures { position -> if(takeover) model.command("computer.input", JSONObject().put("kind", "click").put("x", position.x / size.width).put("y", position.y / size.height)) } })
    Row { Switch(takeover, { active -> takeover = active; model.command("computer.takeover", JSONObject().put("active", active)) }, enabled = model.remote.connected && track != null); Text("Take control · pauses automation", Modifier.padding(top = 12.dp)) }
    OutlinedTextField(input, { input = it }, label = { Text("Type on PC") }, modifier = Modifier.fillMaxWidth())
    Button(onClick = { model.command("computer.input", JSONObject().put("kind", "text").put("text", input)); input = "" }, enabled = takeover && model.remote.connected) { Text("Type") }
    DisposableEffect(Unit) { onDispose { if(takeover && model.remote.connected) model.command("computer.takeover", JSONObject().put("active", false)) } }
}

@Composable fun ChatPane(model: FoxModel) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val conversations = model.list("conversations")
    var choose by remember { mutableStateOf(false) }
    var groupDialog by remember { mutableStateOf(false) }
    var groupTitle by remember { mutableStateOf("") }
    val groupMembers = remember { mutableStateListOf<String>() }
    val id = model.selectedConversation ?: conversations.lastOrNull()?.optString("id")
    var text by remember(id) { mutableStateOf(if(id != null) model.draft(id) else "") }
    LaunchedEffect(model.sentConversation) { if(model.sentConversation?.first == id) text = "" }
    val voice = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result -> result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.let { text += it; if(id != null) model.saveDraft(id, text) } }
    val pickFile = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if(uri != null) runCatching {
        var name = "attachment"
        context.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor -> if(cursor.moveToFirst()) name = cursor.getString(0) }
        val bytes = context.contentResolver.openInputStream(uri)?.use { stream ->
            val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192)
            while(true) { val count = stream.read(buffer); if(count == -1) break; require(output.size() + count <= 20 * 1024 * 1024) { "Attachments are limited to 20 MiB" }; output.write(buffer, 0, count) }; output.toByteArray()
        } ?: error("Cannot read attachment")
        require(bytes.size <= 20 * 1024 * 1024) { "Attachments are limited to 20 MiB" }
        model.command("attachment.upload", JSONObject().put("name", name).put("mime", context.contentResolver.getType(uri) ?: "application/octet-stream").put("base64", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)))
    }.onFailure { model.error = it.message } }
    Button(onClick = { choose = !choose }) { Text(conversations.firstOrNull { it.optString("id") == id }?.optString("title") ?: "Choose conversation") }
    TextButton(onClick = { groupDialog = true }, enabled = model.remote.connected) { Text("New group conversation") }
    if(groupDialog) AlertDialog(onDismissRequest = { groupDialog = false }, title = { Text("Group conversation") }, text = { Column {
        OutlinedTextField(groupTitle, { groupTitle = it }, label = { Text("Title") })
        model.list("bots").forEach { bot -> Row { Checkbox(bot.getString("id") in groupMembers, { checked -> if(checked) groupMembers.add(bot.getString("id")) else groupMembers.remove(bot.getString("id")) }); Text(bot.optString("name"), Modifier.padding(top = 12.dp)) } }
    } }, confirmButton = { TextButton(onClick = { model.command("conversation.create", JSONObject().put("title", groupTitle).put("botIds", JSONArray(groupMembers))); groupDialog = false; groupMembers.clear(); groupTitle = "" }, enabled = groupMembers.size >= 2 && groupTitle.isNotBlank()) { Text("Create group") } }, dismissButton = { TextButton(onClick = { groupDialog = false }) { Text("Cancel") } })
    if(choose) conversations.forEach { c -> TextButton(onClick = { model.selectedConversation = c.getString("id"); choose = false }) { Text(c.optString("title")) } }
    LazyColumn(Modifier.fillMaxWidth().heightIn(max = 400.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { items(model.list("messages").filter { it.optString("conversationId") == id }, key = { it.getString("id") }) { message ->
        Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(12.dp)) { Text(message.optString("role"), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary); Text(message.optString("content")) } }
    } }
    model.list("runs").filter { it.optString("conversationId") == id && it.optString("status") in listOf("running", "queued", "awaiting_approval", "awaiting_input") }.forEach { run -> Row { Text(run.optString("status"), Modifier.weight(1f)); TextButton(onClick = { model.command("run.cancel", JSONObject().put("id", run.getString("id"))) }) { Text("Cancel") } } }
    OutlinedTextField(text, { text = it; if(id != null) model.saveDraft(id, it) }, label = { Text("Message your bot") }, modifier = Modifier.fillMaxWidth(), maxLines = 5)
    model.uploadedAttachments.forEach { file -> Row { Text(file.optString("name"), Modifier.weight(1f)); TextButton(onClick = { model.uploadedAttachments = model.uploadedAttachments.filter { it != file } }) { Text("Remove") } } }
    Row { Button(onClick = { if(id != null && (text.isNotBlank() || model.uploadedAttachments.isNotEmpty())) model.sendMessage(id, text) }, enabled = model.remote.connected && id != null) { Text("Send") }; TextButton(onClick = { runCatching { voice.launch(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)) }.onFailure { model.error = "Install a speech recognition service to dictate" } }) { Text("Dictate") }; TextButton(onClick = { pickFile.launch(arrayOf("*/*")) }, enabled = model.remote.connected) { Text("Attach") } }
}

@Composable fun EntityEditor(type: String, original: JSONObject, model: FoxModel, onDismiss: () -> Unit) {
    val fields = when(type) { "bot" -> listOf("name", "role", "instructions", "avatar", "providerId", "model"); "skill" -> listOf("name", "description", "markdown"); "memory" -> listOf("botId", "text"); else -> listOf("name", "botId", "prompt", "cron", "timezone") }
    val values = remember { mutableStateMapOf<String, String>().apply { fields.forEach { put(it, original.optString(it, when(it) { "timezone" -> java.util.TimeZone.getDefault().id; "cron" -> "0 9 * * *"; "avatar" -> "🦊"; else -> "" })) } } }
    var enabled by remember { mutableStateOf(original.optBoolean("enabled", true)) }
    AlertDialog(onDismissRequest = onDismiss, title = { Text("${if(original.has("id")) "Edit" else "Create"} $type") }, text = { LazyColumn { items(fields) { key -> OutlinedTextField(values[key] ?: "", { values[key] = it }, label = { Text(key) }, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp), maxLines = if(key in listOf("instructions", "markdown", "prompt", "text")) 4 else 1) }; if(type in listOf("routine", "memory")) item { Row { Switch(enabled, { enabled = it }); Text("Enabled") } } } }, confirmButton = { TextButton(onClick = { val payload = JSONObject(original.toString()); fields.forEach { payload.put(it, values[it]) }; if(type in listOf("routine", "memory")) payload.put("enabled", enabled); model.command(if(type == "bot") if(original.has("id")) "bot.update" else "bot.create" else "$type.save", payload); onDismiss() }, enabled = model.remote.connected && !values[if(type == "memory") "text" else "name"].isNullOrBlank()) { Text("Save") } }, dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } })
}
