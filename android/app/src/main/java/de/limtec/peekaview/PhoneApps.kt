package de.limtec.peekaview

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import org.json.JSONArray
import org.json.JSONObject

object PhoneApps {
    data class App(val id: String, val name: String, val uid: Int, val shareable: Boolean) {
        fun captureJson() = JSONObject().put("id", id).put("uid", uid)
        fun json() = JSONObject().put("id", id).put("name", name).put("kind", "app").put("shareable", shareable)
    }

    fun installed(context: Context): List<App> = context.packageManager
        .queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), PackageManager.MATCH_ALL)
        .filter { it.activityInfo.enabled && it.activityInfo.exported }
        .map {
            val uid = it.activityInfo.applicationInfo.uid
            App(it.activityInfo.packageName, it.loadLabel(context.packageManager).toString(), uid,
                uid >= 10000 && context.packageManager.getPackagesForUid(uid)?.size == 1)
        }
        .distinctBy { it.id }.sortedBy { it.name.lowercase() }

    fun allowed(context: Context) = installed(context).filter { it.id in Prefs.shellApps(context) }

    fun selection(context: Context, ids: Set<String>, appsOnly: Boolean): List<App> {
        require(!appsOnly || android.os.Build.VERSION.SDK_INT >= 34) { "App-Freigabe benötigt Android 14 oder neuer." }
        val installed = installed(context)
        require(installed.map { it.id }.containsAll(ids)) { "Die App-Auswahl ist nicht mehr aktuell. Bitte neu öffnen." }
        return installed.filter { it.id in ids }.also { selected ->
            require(!appsOnly || selected.all { it.shareable }) { "Apps mit gemeinsamer System-Identität können nicht einzeln freigegeben werden." }
        }
    }

    fun choices(context: Context): JSONArray {
        val selected = Prefs.shellApps(context)
        return JSONArray(installed(context).map { it.json().put("selected", it.id in selected) })
    }
}
