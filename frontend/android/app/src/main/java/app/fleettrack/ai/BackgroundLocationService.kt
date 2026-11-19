package app.fleettrack.ai

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.TimeUnit

class BackgroundLocationService : Service() {

    companion object {
        const val CHANNEL_ID = "fleettrack_tracking_channel"
        const val NOTIFICATION_ID = 9021

        const val ACTION_START = "app.fleettrack.ai.ACTION_START"
        const val ACTION_STOP = "app.fleettrack.ai.ACTION_STOP"
        const val ACTION_UPDATE_ADAPTIVE = "app.fleettrack.ai.ACTION_UPDATE_ADAPTIVE"

        const val EXTRA_JOURNEY_ID = "journey_id"
        const val EXTRA_AUTH_TOKEN = "auth_token"
        const val EXTRA_API_BASE_URL = "api_base_url"
        const val EXTRA_VEHICLE_REG = "vehicle_reg"
        const val EXTRA_DESTINATION = "destination"
        const val EXTRA_INTERVAL_SEC = "interval_sec"
        const val EXTRA_ADAPTIVE_STATE = "adaptive_state"
        const val EXTRA_STATUS_LABEL = "status_label"
        const val EXTRA_BATTERY_SAVING = "battery_saving"

        @Volatile
        var isServiceRunning = false
            private set
    }

    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var locationCallback: LocationCallback
    private lateinit var dbHelper: LocationBufferDatabaseHelper
    private var wakeLock: PowerManager.WakeLock? = null

    private var journeyId: String? = null
    private var authToken: String? = null
    private var apiBaseUrl: String? = null
    private var vehicleReg: String = "Vehicle"
    private var destinationName: String = "Destination"
    private var currentIntervalSec: Int = 5
    private var currentAdaptiveState: String = "MOVING"
    private var currentStatusLabel: String = "MOVING"
    private var currentBatterySaving: Boolean = false

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    private val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    override fun onCreate() {
        super.onCreate()
        dbHelper = LocationBufferDatabaseHelper(this)
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)

        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "FleetTrack:GpsWakeLock").apply {
            setReferenceCounted(false)
        }

        createNotificationChannel()

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                for (location in result.locations) {
                    processNewLocation(location)
                }
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null) return START_STICKY

        when (intent.action) {
            ACTION_START -> {
                journeyId = intent.getStringExtra(EXTRA_JOURNEY_ID)
                authToken = intent.getStringExtra(EXTRA_AUTH_TOKEN)
                apiBaseUrl = intent.getStringExtra(EXTRA_API_BASE_URL)
                vehicleReg = intent.getStringExtra(EXTRA_VEHICLE_REG) ?: "Vehicle"
                destinationName = intent.getStringExtra(EXTRA_DESTINATION) ?: "Destination"
                currentIntervalSec = intent.getIntExtra(EXTRA_INTERVAL_SEC, 5)
                currentAdaptiveState = intent.getStringExtra(EXTRA_ADAPTIVE_STATE) ?: "MOVING"
                currentStatusLabel = intent.getStringExtra(EXTRA_STATUS_LABEL) ?: "MOVING"
                currentBatterySaving = intent.getBooleanExtra(EXTRA_BATTERY_SAVING, false)

                startTrackingForeground()
            }
            ACTION_UPDATE_ADAPTIVE -> {
                val newInterval = intent.getIntExtra(EXTRA_INTERVAL_SEC, currentIntervalSec)
                val newState = intent.getStringExtra(EXTRA_ADAPTIVE_STATE) ?: currentAdaptiveState
                val newLabel = intent.getStringExtra(EXTRA_STATUS_LABEL) ?: currentStatusLabel
                val newBattery = intent.getBooleanExtra(EXTRA_BATTERY_SAVING, currentBatterySaving)

                val intervalChanged = (newInterval != currentIntervalSec)
                currentIntervalSec = newInterval
                currentAdaptiveState = newState
                currentStatusLabel = newLabel
                currentBatterySaving = newBattery

                updateNotification()

                if (intervalChanged && isServiceRunning) {
                    requestLocationUpdatesWithInterval(currentIntervalSec)
                }
            }
            ACTION_STOP -> {
                stopTracking()
                stopSelf()
            }
        }

        return START_STICKY
    }

    private fun startTrackingForeground() {
        isServiceRunning = true
        try {
            wakeLock?.acquire(24 * 60 * 60 * 1000L) // Safe max 24 hours
        } catch (e: Exception) {
            e.printStackTrace()
        }

        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        requestLocationUpdatesWithInterval(currentIntervalSec)
    }

    private fun requestLocationUpdatesWithInterval(intervalSec: Int) {
        val intervalMs = (intervalSec.coerceAtLeast(2) * 1000).toLong()
        val minIntervalMs = (intervalMs / 2).coerceAtLeast(1000)

        val locationRequest = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
            .setMinUpdateIntervalMillis(minIntervalMs)
            .setMinUpdateDistanceMeters(0f)
            .setWaitForAccurateLocation(false)
            .build()

        try {
            fusedLocationClient.removeLocationUpdates(locationCallback)
            fusedLocationClient.requestLocationUpdates(
                locationRequest,
                locationCallback,
                Looper.getMainLooper()
            )
        } catch (e: SecurityException) {
            e.printStackTrace()
        }
    }

    private fun processNewLocation(location: Location) {
        val speedKmh = (location.speed * 3.6f).coerceAtLeast(0f)
        val headingDeg = if (location.hasBearing()) location.bearing else 0f
        val accuracyM = if (location.hasAccuracy()) location.accuracy else 10f
        val altitudeM = if (location.hasAltitude()) location.altitude else null
        val timeIso = isoFormat.format(Date(location.time))

        val pingJson = JSONObject().apply {
            put("latitude", location.latitude)
            put("longitude", location.longitude)
            put("speed", speedKmh.toDouble())
            put("heading", headingDeg.toDouble())
            put("accuracy", accuracyM.toDouble())
            if (altitudeM != null) {
                put("altitude", altitudeM)
            }
            put("timestamp", timeIso)
            put("adaptive_state", currentAdaptiveState)
            put("acquisition_interval_sec", currentIntervalSec)
            put("transmission_interval_sec", currentIntervalSec)
            put("battery_saving", currentBatterySaving)
        }

        // 1. Dispatch directly to Capacitor Webview listeners if UI is alive
        BackgroundLocationPlugin.dispatchLocation(pingJson)

        // 2. Direct native HTTP upload for guaranteed continuity during phone sleep / background apps
        val jId = journeyId
        val base = apiBaseUrl
        val token = authToken

        if (jId != null && base != null && token != null) {
            transmitLocation(jId, base, token, pingJson)
        }
    }

    private fun transmitLocation(
        jId: String,
        base: String,
        token: String,
        pingJson: JSONObject
    ) {
        val url = "${base.trimEnd('/')}/api/journeys/$jId/location"
        val body = pingJson.toString().toRequestBody("application/json; charset=utf-8".toMediaType())

        val request = Request.Builder()
            .url(url)
            .post(body)
            .addHeader("Authorization", "Bearer $token")
            .build()

        httpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                // Network failed or offline -> Buffer in SQLite
                dbHelper.enqueuePing(jId, pingJson.toString())
            }

            override fun onResponse(call: Call, response: Response) {
                response.use { res ->
                    if (res.isSuccessful) {
                        // Success -> Check if there are buffered pings to drain
                        drainOfflineBuffer(jId, base, token)
                    } else if (res.code == 410 || res.code == 404) {
                        // Journey finished on server
                        stopTracking()
                        stopSelf()
                    } else {
                        // Server rejected or temporary 5xx -> Buffer in SQLite
                        dbHelper.enqueuePing(jId, pingJson.toString())
                    }
                }
            }
        })
    }

    private fun drainOfflineBuffer(jId: String, base: String, token: String) {
        val pending = dbHelper.getPendingPings(jId, limit = 50)
        if (pending.isEmpty()) return

        val pingsArray = JSONArray()
        val idsToDelete = mutableListOf<Long>()

        for ((id, json) in pending) {
            pingsArray.put(json)
            idsToDelete.add(id)
        }

        val batchObj = JSONObject().apply {
            put("pings", pingsArray)
        }

        val batchUrl = "${base.trimEnd('/')}/api/journeys/$jId/location/batch"
        val body = batchObj.toString().toRequestBody("application/json; charset=utf-8".toMediaType())

        val batchRequest = Request.Builder()
            .url(batchUrl)
            .post(body)
            .addHeader("Authorization", "Bearer $token")
            .build()

        httpClient.newCall(batchRequest).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                // Keep buffered for next retry
            }

            override fun onResponse(call: Call, response: Response) {
                response.use { res ->
                    if (res.isSuccessful) {
                        dbHelper.deletePings(idsToDelete)
                    }
                }
            }
        })
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "FleetTrack Active GPS Tracking",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Continuous high-accuracy location tracking during active deliveries"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName) ?: Intent(this, MainActivity::class.java)
        launchIntent.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP

        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
        )

        val subtext = "Vehicle: $vehicleReg • Mode: $currentStatusLabel"
        val content = if (currentBatterySaving) {
            "Battery-saving mode • Updating every ${currentIntervalSec}s"
        } else {
            "Live GPS active • Updating every ${currentIntervalSec}s"
        }

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("FleetTrack Delivery Active")
            .setContentText(content)
            .setSubText(subtext)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(pendingIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build()
    }

    private fun updateNotification() {
        if (!isServiceRunning) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, buildNotification())
    }

    private fun stopTracking() {
        isServiceRunning = false
        try {
            fusedLocationClient.removeLocationUpdates(locationCallback)
        } catch (e: Exception) {
            e.printStackTrace()
        }
        try {
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        stopForeground(STOP_FOREGROUND_REMOVE)
    }

    override fun onDestroy() {
        stopTracking()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
