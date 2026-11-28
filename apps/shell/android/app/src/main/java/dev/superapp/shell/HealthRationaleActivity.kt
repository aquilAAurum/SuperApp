package dev.superapp.shell

import android.app.Activity
import android.os.Bundle
import android.widget.ScrollView
import android.widget.TextView

/**
 * Shown by Health Connect when the owner taps "Read privacy policy" in its permission screen
 * (Android 13: ACTION_SHOW_PERMISSIONS_RATIONALE; Android 14+: VIEW_PERMISSION_USAGE alias).
 * Health Connect refuses to show Supra's permission dialog unless this activity exists (ADR-010).
 */
class HealthRationaleActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = (24 * resources.displayMetrics.density).toInt()
        val text = TextView(this).apply {
            setPadding(pad, pad, pad, pad)
            textSize = 16f
            text = getString(R.string.health_rationale)
        }
        setContentView(ScrollView(this).apply { addView(text) })
    }
}
