package app.fleettrack.ai

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONObject

@CapacitorPlugin(
    name = "BackgroundLocation",
    permissions = [
        Permission(
            alias = "location",
            strings = [
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            ]
        ),
        Permission(
            alias = "notifications",
            strings = [
                Manifest.permission.POST_NOTIFICATIONS
            ]
        )
    ]
)
class BackgroundLocationPlugin : Plugin() {

    companion object {
        private var instance: BackgroundLocationPlugin? = null

        fun dispatchLocation(json: JSONObject) {
            instance?.let { plugin ->
                try {
                    val jsObj = JSObject.fromJSONObject(json)
                    plugin.notifyListeners("onLocationUpdate", jsObj)
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
        }
    }

    override fun load() {
        super.load()
        instance = this
    }

    @PluginMethod
    fun startTracking(call: PluginCall) {
        val journeyId = call.getString("journeyId")
        val token = call.getString("token")
        val apiBaseUrl = call.getString("apiBaseUrl")
        val vehicleReg = call.getString("vehicleReg", "Vehicle")
        val destination = call.getString("destination", "Destination")
        val intervalSec = call.getInt("intervalSec", 5) ?: 5
        val adaptiveState = call.getString("adaptiveState", "MOVING")
        val statusLabel = call.getString("statusLabel", "MOVING")
        val batterySaving = call.getBoolean("batterySaving", false) ?: false

        if (journeyId.isNullOrEmpty() || token.isNullOrEmpty() || apiBaseUrl.isNullOrEmpty()) {
            call.reject("journeyId, token, and apiBaseUrl are required")
            return
        }

        val context = activity?.applicationContext ?: context
        val intent = Intent(context, BackgroundLocationService::class.java).apply {
            action = BackgroundLocationService.ACTION_START
            putExtra(BackgroundLocationService.EXTRA_JOURNEY_ID, journeyId)
            putExtra(BackgroundLocationService.EXTRA_AUTH_TOKEN, token)
            putExtra(BackgroundLocationService.EXTRA_API_BASE_URL, apiBaseUrl)
            putExtra(BackgroundLocationService.EXTRA_VEHICLE_REG, vehicleReg)
            putExtra(BackgroundLocationService.EXTRA_DESTINATION, destination)
            putExtra(BackgroundLocationService.EXTRA_INTERVAL_SEC, intervalSec)
            putExtra(BackgroundLocationService.EXTRA_ADAPTIVE_STATE, adaptiveState)
            putExtra(BackgroundLocationService.EXTRA_STATUS_LABEL, statusLabel)
            putExtra(BackgroundLocationService.EXTRA_BATTERY_SAVING, batterySaving)
        }

        try {
            ContextCompat.startForegroundService(context, intent)
            val ret = JSObject().apply {
                put("success", true)
                put("isTracking", true)
            }
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Failed to start background tracking service: ${e.message}", e)
        }
    }

    @PluginMethod
    fun stopTracking(call: PluginCall) {
        val context = activity?.applicationContext ?: context
        val intent = Intent(context, BackgroundLocationService::class.java).apply {
            action = BackgroundLocationService.ACTION_STOP
        }

        try {
            context.startService(intent)
            val ret = JSObject().apply {
                put("success", true)
                put("isTracking", false)
            }
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Failed to stop background tracking service: ${e.message}", e)
        }
    }

    @PluginMethod
    fun updateAdaptiveState(call: PluginCall) {
        val intervalSec = call.getInt("intervalSec", 5) ?: 5
        val adaptiveState = call.getString("adaptiveState", "MOVING")
        val statusLabel = call.getString("statusLabel", "MOVING")
        val batterySaving = call.getBoolean("batterySaving", false) ?: false

        val context = activity?.applicationContext ?: context
        val intent = Intent(context, BackgroundLocationService::class.java).apply {
            action = BackgroundLocationService.ACTION_UPDATE_ADAPTIVE
            putExtra(BackgroundLocationService.EXTRA_INTERVAL_SEC, intervalSec)
            putExtra(BackgroundLocationService.EXTRA_ADAPTIVE_STATE, adaptiveState)
            putExtra(BackgroundLocationService.EXTRA_STATUS_LABEL, statusLabel)
            putExtra(BackgroundLocationService.EXTRA_BATTERY_SAVING, batterySaving)
        }

        try {
            context.startService(intent)
            val ret = JSObject().apply {
                put("success", true)
            }
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Failed to update adaptive state: ${e.message}", e)
        }
    }

    @PluginMethod
    fun getTrackingStatus(call: PluginCall) {
        val ret = JSObject().apply {
            put("isTracking", BackgroundLocationService.isServiceRunning)
        }
        call.resolve(ret)
    }

    @PluginMethod
    fun checkPermissionsStatus(call: PluginCall) {
        val context = activity?.applicationContext ?: context

        val fineLocationGranted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        val bgLocationGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.ACCESS_BACKGROUND_LOCATION
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }

        val notificationGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }

        val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val isIgnoringBatteryOptimizations = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            powerManager.isIgnoringBatteryOptimizations(context.packageName)
        } else {
            true
        }

        val ret = JSObject().apply {
            put("fineLocation", fineLocationGranted)
            put("backgroundLocation", bgLocationGranted)
            put("notifications", notificationGranted)
            put("ignoringBatteryOptimizations", isIgnoringBatteryOptimizations)
            put("allGranted", fineLocationGranted && notificationGranted)
        }
        call.resolve(ret)
    }

    @PluginMethod
    fun requestAllPermissions(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestPermissionForAliases(arrayOf("location", "notifications"), call, "allPermissionsCallback")
        } else {
            requestPermissionForAlias("location", call, "allPermissionsCallback")
        }
    }

    @PermissionCallback
    fun allPermissionsCallback(call: PluginCall) {
        checkPermissionsStatus(call)
    }

    @PluginMethod
    fun requestBackgroundLocationPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val context = activity?.applicationContext ?: context
            val bgGranted = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.ACCESS_BACKGROUND_LOCATION
            ) == PackageManager.PERMISSION_GRANTED

            if (!bgGranted) {
                // Background location on Android 11+ must be requested separately after fine location
                activity?.requestPermissions(
                    arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION),
                    1002
                )
            }
        }
        val ret = JSObject().apply { put("requested", true) }
        call.resolve(ret)
    }

    @PluginMethod
    fun checkBatteryOptimizations(call: PluginCall) {
        val context = activity?.applicationContext ?: context
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val isIgnoring = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            powerManager.isIgnoringBatteryOptimizations(context.packageName)
        } else {
            true
        }

        val ret = JSObject().apply {
            put("ignoringBatteryOptimizations", isIgnoring)
        }
        call.resolve(ret)
    }

    @PluginMethod
    fun requestIgnoreBatteryOptimizations(call: PluginCall) {
        val context = activity?.applicationContext ?: context
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                val intent = Intent().apply {
                    action = Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
                    data = Uri.parse("package:${context.packageName}")
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                context.startActivity(intent)
                call.resolve(JSObject().apply { put("success", true) })
            } catch (e: Exception) {
                // Fallback to general settings
                try {
                    val fallbackIntent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    }
                    context.startActivity(fallbackIntent)
                    call.resolve(JSObject().apply { put("success", true) })
                } catch (e2: Exception) {
                    call.reject("Could not open battery optimization settings: ${e2.message}")
                }
            }
        } else {
            call.resolve(JSObject().apply { put("success", true) })
        }
    }
}
