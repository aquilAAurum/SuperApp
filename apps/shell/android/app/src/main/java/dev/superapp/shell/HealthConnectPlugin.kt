package dev.superapp.shell

import android.content.Intent
import android.net.Uri
import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.aggregate.AggregateMetric
import androidx.health.connect.client.aggregate.AggregationResult
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HydrationRecord
import androidx.health.connect.client.records.MealType
import androidx.health.connect.client.records.NutritionRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.health.connect.client.units.Energy
import androidx.health.connect.client.units.Length
import androidx.health.connect.client.units.Mass
import androidx.health.connect.client.units.Volume
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.time.Duration
import java.time.OffsetDateTime
import java.time.Period
import java.time.ZoneId
import kotlin.reflect.KClass
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Health Connect for the Supra shell (ADR-010). Called only by CapabilityBroker.ts; subapps reach it
 * through the bridge (`device.health.*`) after the shell checked their manifest and consent.
 *
 * Deliberately thin: it reads aggregates and writes the three record types in [WRITE_TYPES], and it
 * refuses any permission outside [READ] / [WRITE]. Values are never logged.
 */
@CapacitorPlugin(name = "HealthConnect")
class HealthConnectPlugin : Plugin() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private fun client(): HealthConnectClient = HealthConnectClient.getOrCreate(context)

    private fun sdkStatus(): String = when (HealthConnectClient.getSdkStatus(context, PROVIDER)) {
        HealthConnectClient.SDK_AVAILABLE -> "available"
        HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "update_required"
        else -> "unavailable"
    }

    /** Granted Health Connect permissions as short names (READ_STEPS), limited to the ones Supra uses. */
    private suspend fun granted(): Set<String> =
        client().permissionController.getGrantedPermissions()
            .filter { it.startsWith(PREFIX) }
            .map { it.removePrefix(PREFIX) }
            .filter { it in READ.values || it in WRITE.values }
            .toSet()

    private fun launch(call: PluginCall, block: suspend () -> Unit) {
        if (sdkStatus() != "available") {
            call.reject("Health Connect is not available on this device.", "UNAVAILABLE")
            return
        }
        scope.launch {
            try {
                block()
            } catch (e: SecurityException) {
                call.reject("Health Connect permission missing.", "SCOPE_DENIED")
            } catch (e: IllegalArgumentException) {
                call.reject(e.message ?: "Invalid Health Connect request.", "INVALID_PARAMS")
            } catch (e: Exception) {
                call.reject("Health Connect call failed.", "INTERNAL")
            }
        }
    }

    @PluginMethod
    fun status(call: PluginCall) {
        val status = sdkStatus()
        if (status != "available") {
            call.resolve(JSObject().put("sdkStatus", status).put("granted", JSArray()))
            return
        }
        scope.launch {
            val list = try { granted() } catch (e: Exception) { emptySet() }
            call.resolve(JSObject().put("sdkStatus", status).put("granted", JSArray(list.toList())))
        }
    }

    @PluginMethod
    fun requestHealthPermissions(call: PluginCall) {
        val asked = call.getArray("permissions")?.toList<String>().orEmpty()
        val allowed = asked.filter { it in READ.values || it in WRITE.values }.map { PREFIX + it }.toSet()
        if (allowed.isEmpty() || allowed.size != asked.toSet().size) {
            call.reject("Unknown Health Connect permission.", "INVALID_PARAMS")
            return
        }
        if (sdkStatus() != "available") {
            call.reject("Health Connect is not available on this device.", "UNAVAILABLE")
            return
        }
        val intent = PermissionController.createRequestPermissionResultContract(PROVIDER).createIntent(context, allowed)
        startActivityForResult(call, intent, "onPermissionsResult")
    }

    @ActivityCallback
    fun onPermissionsResult(call: PluginCall?, @Suppress("UNUSED_PARAMETER") result: ActivityResult) {
        if (call == null) return
        // Read the result back from Health Connect rather than trusting the intent extras.
        scope.launch {
            val list = try { granted() } catch (e: Exception) { emptySet() }
            call.resolve(JSObject().put("granted", JSArray(list.toList())))
        }
    }

    @PluginMethod
    fun aggregate(call: PluginCall) = launch(call) {
        val names = call.getArray("metrics")?.toList<String>().orEmpty()
        val start = OffsetDateTime.parse(call.getString("start"))
        val end = OffsetDateTime.parse(call.getString("end"))
        require(end.isAfter(start)) { "end must be after start" }
        val perms = granted()
        val metrics = names.filter { READ[it]?.let(perms::contains) == true }.mapNotNull { name -> METRICS[name]?.let { name to it } }
        val buckets = JSArray()
        if (metrics.isEmpty()) {
            call.resolve(JSObject().put("buckets", buckets))
            return@launch
        }
        val set = metrics.map { it.second }.toSet<AggregateMetric<*>>()
        if (call.getString("bucket") == "none") {
            val r = client().aggregate(AggregateRequest(set, TimeRangeFilter.between(start.toInstant(), end.toInstant())))
            buckets.put(bucket(start.toString(), end.toString(), r, metrics))
        } else {
            // Local-time day buckets in the caller's offset, so "today" matches the owner's clock.
            val zone: ZoneId = start.offset
            val req = AggregateGroupByPeriodRequest(set, TimeRangeFilter.between(start.toLocalDateTime(), end.atZoneSameInstant(zone).toLocalDateTime()), Period.ofDays(1))
            for (g in client().aggregateGroupByPeriod(req)) {
                buckets.put(bucket(g.startTime.atZone(zone).toOffsetDateTime().toString(), g.endTime.atZone(zone).toOffsetDateTime().toString(), g.result, metrics))
            }
        }
        call.resolve(JSObject().put("buckets", buckets))
    }

    private fun bucket(start: String, end: String, r: AggregationResult, metrics: List<Pair<String, AggregateMetric<*>>>): JSObject {
        val values = JSObject()
        for ((name, metric) in metrics) {
            @Suppress("UNCHECKED_CAST")
            val v: Double? = when (val raw: Any? = r[metric as AggregateMetric<Any>]) {
                null -> null
                is Long -> raw.toDouble()
                is Energy -> raw.inKilocalories
                is Length -> raw.inMeters
                is Mass -> raw.inKilograms
                is Volume -> raw.inLiters
                is Duration -> raw.toMinutes().toDouble()
                else -> null
            }
            if (v != null && v.isFinite()) values.put(name, Math.round(v * 100) / 100.0)
        }
        return JSObject().put("start", start).put("end", end).put("values", values)
    }

    @PluginMethod
    fun insert(call: PluginCall) = launch(call) {
        val perms = granted()
        val input = call.data.getJSONArray("records")
        val records = mutableListOf<Record>()
        val version = System.currentTimeMillis() // higher than any earlier write, so upserts replace
        for (i in 0 until input.length()) {
            val o = input.getJSONObject(i)
            val type = o.getString("type")
            if (WRITE[type]?.let(perms::contains) != true) continue
            records.add(toRecord(type, o, Metadata.manualEntry(clientRecordId = o.getString("clientId"), clientRecordVersion = version)))
        }
        if (records.isNotEmpty()) client().insertRecords(records)
        call.resolve(JSObject().put("written", records.size))
    }

    private fun toRecord(type: String, o: JSONObject, meta: Metadata): Record = when (type) {
        "nutrition" -> {
            val (s, e) = interval(o)
            NutritionRecord(
                startTime = s.toInstant(), startZoneOffset = s.offset,
                endTime = e.toInstant(), endZoneOffset = e.offset,
                metadata = meta,
                name = o.optString("name").takeIf { it.isNotEmpty() },
                mealType = MEALS[o.optString("mealType")] ?: MealType.MEAL_TYPE_UNKNOWN,
                energy = Energy.kilocalories(o.getDouble("energyKcal")),
                protein = o.grams("proteinG"),
                totalCarbohydrate = o.grams("carbsG"),
                totalFat = o.grams("fatG"),
                dietaryFiber = o.grams("fiberG"),
                sugar = o.grams("sugarG"),
                sodium = if (o.has("sodiumMg")) Mass.milligrams(o.getDouble("sodiumMg")) else null,
            )
        }
        "weight" -> {
            val t = OffsetDateTime.parse(o.getString("time"))
            WeightRecord(time = t.toInstant(), zoneOffset = t.offset, weight = Mass.kilograms(o.getDouble("kg")), metadata = meta)
        }
        "hydration" -> {
            val (s, e) = interval(o)
            HydrationRecord(startTime = s.toInstant(), startZoneOffset = s.offset, endTime = e.toInstant(), endZoneOffset = e.offset, volume = Volume.liters(o.getDouble("liters")), metadata = meta)
        }
        else -> throw IllegalArgumentException("Unsupported record type")
    }

    /** Health Connect needs start < end; a meal logged "at" a moment gets a one-minute interval. */
    private fun interval(o: JSONObject): Pair<OffsetDateTime, OffsetDateTime> {
        val s = OffsetDateTime.parse(o.getString("start"))
        val e = OffsetDateTime.parse(o.getString("end"))
        return s to (if (e.isAfter(s)) e else s.plusMinutes(1))
    }

    private fun JSONObject.grams(key: String): Mass? = if (has(key)) Mass.grams(getDouble(key)) else null

    @PluginMethod
    fun delete(call: PluginCall) = launch(call) {
        val type = call.getString("type") ?: ""
        val cls = WRITE_TYPES[type] ?: throw IllegalArgumentException("Unsupported record type")
        if (WRITE[type]?.let(granted()::contains) != true) {
            call.resolve(JSObject().put("deleted", 0))
            return@launch
        }
        val ids = call.getArray("clientIds")?.toList<String>().orEmpty()
        client().deleteRecords(cls, emptyList(), ids)
        call.resolve(JSObject().put("deleted", ids.size))
    }

    @PluginMethod
    fun openSettings(call: PluginCall) {
        val intent = if (sdkStatus() == "available") {
            Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS)
        } else {
            Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$PROVIDER&url=healthconnect%3A%2F%2Fonboarding")).setPackage("com.android.vending")
        }
        try {
            activity.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            call.resolve()
        } catch (e: Exception) {
            call.reject("Couldn't open Health Connect.", "UNAVAILABLE")
        }
    }

    override fun handleOnDestroy() {
        scope.cancel()
    }

    companion object {
        private const val PROVIDER = "com.google.android.apps.healthdata"
        private const val PREFIX = "android.permission.health."

        /** Contract metric → permission (mirrors HEALTH_READ_PERMISSION in packages/contracts/src/health.ts). */
        val READ = mapOf(
            "steps" to "READ_STEPS",
            "distance" to "READ_DISTANCE",
            "activeCalories" to "READ_ACTIVE_CALORIES_BURNED",
            "totalCalories" to "READ_TOTAL_CALORIES_BURNED",
            "exerciseMinutes" to "READ_EXERCISE",
            "sleepMinutes" to "READ_SLEEP",
            "restingHeartRate" to "READ_RESTING_HEART_RATE",
            "weight" to "READ_WEIGHT",
            "hydration" to "READ_HYDRATION",
            "nutrition" to "READ_NUTRITION",
        )
        val WRITE = mapOf(
            "nutrition" to "WRITE_NUTRITION",
            "weight" to "WRITE_WEIGHT",
            "hydration" to "WRITE_HYDRATION",
        )
        private val WRITE_TYPES: Map<String, KClass<out Record>> = mapOf(
            "nutrition" to NutritionRecord::class,
            "weight" to WeightRecord::class,
            "hydration" to HydrationRecord::class,
        )
        private val METRICS: Map<String, AggregateMetric<*>> = mapOf(
            "steps" to StepsRecord.COUNT_TOTAL,
            "distance" to DistanceRecord.DISTANCE_TOTAL,
            "activeCalories" to ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL,
            "totalCalories" to TotalCaloriesBurnedRecord.ENERGY_TOTAL,
            "exerciseMinutes" to ExerciseSessionRecord.EXERCISE_DURATION_TOTAL,
            "sleepMinutes" to SleepSessionRecord.SLEEP_DURATION_TOTAL,
            "restingHeartRate" to RestingHeartRateRecord.BPM_AVG,
            "weight" to WeightRecord.WEIGHT_AVG,
            "hydration" to HydrationRecord.VOLUME_TOTAL,
            "nutrition" to NutritionRecord.ENERGY_TOTAL,
        )
        private val MEALS = mapOf(
            "breakfast" to MealType.MEAL_TYPE_BREAKFAST,
            "lunch" to MealType.MEAL_TYPE_LUNCH,
            "dinner" to MealType.MEAL_TYPE_DINNER,
            "snack" to MealType.MEAL_TYPE_SNACK,
            "unknown" to MealType.MEAL_TYPE_UNKNOWN,
        )
    }
}
