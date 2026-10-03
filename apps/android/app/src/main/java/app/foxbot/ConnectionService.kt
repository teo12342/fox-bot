package app.foxbot

import android.app.*
import android.content.Intent
import android.os.IBinder

class ConnectionService : Service() {
    override fun onCreate() {
        super.onCreate()
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("connection", "PC connection", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        startForeground(1, Notification.Builder(this, "connection").setContentTitle("Fox Bot connected to your PC").setContentText("Remote connection stays active while this notification is shown.").setSmallIcon(android.R.drawable.stat_notify_sync).setContentIntent(open).build())
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int) = START_NOT_STICKY
    override fun onBind(intent: Intent?): IBinder? = null
}
