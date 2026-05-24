package com.tetr.app.actions

import android.content.Context
import android.content.Intent
import android.graphics.Rect
import android.os.Bundle
import android.util.Log
import android.view.accessibility.AccessibilityNodeInfo
import com.tetr.app.accessibility.TETRAccessibilityService
import com.tetr.app.screen.ScreenCaptureManager
import com.tetr.app.websocket.TETRWebSocketClient
import org.json.JSONObject

/**
 * Ejecuta las acciones que pide el agente en el celular.
 * Después de cada acción, manda el UI tree actualizado al servidor.
 */
class ActionExecutor(private val service: TETRAccessibilityService) {

    companion object {
        private const val TAG = "ActionExecutor"
    }

    fun execute(actionType: String, params: JSONObject) {
        Log.i(TAG, "Ejecutando: $actionType — $params")

        val success = when (actionType) {
            "click"             -> executeClick(params.optString("target"))
            "set_text"          -> executeSetText(params.optString("text"), params.optString("target", ""))
            "scroll_up"         -> executeScrollUp()
            "scroll_down"       -> executeScrollDown()
            "open_app"          -> executeOpenApp(params.optString("appName"))
            "press_back"        -> service.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK)
            "press_home"        -> service.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_HOME)
            "volume_up"         -> executeVolumeChange(params.optInt("steps", 2), up = true)
            "volume_down"       -> executeVolumeChange(params.optInt("steps", 2), up = false)
            "request_screenshot" -> executeScreenshot()
            else -> { Log.w(TAG, "Acción desconocida: $actionType"); false }
        }

        Log.d(TAG, "Acción $actionType — ${if (success) "OK" else "FALLÓ"}")

        // Mandar UI tree actualizado al servidor después de la acción
        // (el servidor ya espera ACTION_SETTLE_MS, esto corre en paralelo)
        sendUpdatedUiTree()
    }

    // ─── Click ────────────────────────────────────────────────────────────────

    private fun executeClick(target: String): Boolean {
        if (target.isBlank()) return false

        val node = service.findNodeByText(target)
        if (node == null) {
            Log.w(TAG, "No encontré: $target")
            return false
        }

        // Intentar click directo
        if (node.isClickable) {
            return node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        }

        // Subir al padre clickable
        var parent = node.parent
        while (parent != null) {
            if (parent.isClickable) {
                return parent.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            }
            parent = parent.parent
        }

        // Último recurso: tap en coordenadas
        val bounds = Rect()
        node.getBoundsInScreen(bounds)
        service.tapAt(bounds.centerX().toFloat(), bounds.centerY().toFloat()) {}
        return true
    }

    // ─── Escribir texto ───────────────────────────────────────────────────────

    private fun executeSetText(text: String, target: String): Boolean {
        if (text.isBlank()) return false

        if (target.isNotBlank()) {
            executeClick(target)
            Thread.sleep(300)
        }

        val root = service.rootInActiveWindow ?: return false
        val focused = findFocusedEditable(root) ?: run {
            Log.w(TAG, "No hay campo de texto activo")
            return false
        }

        val args = Bundle()
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        return focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    }

    private fun findFocusedEditable(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        if (node == null) return null
        if (node.isEditable) return node // tomar el primero editable que encontremos
        for (i in 0 until node.childCount) {
            val result = findFocusedEditable(node.getChild(i))
            if (result != null) return result
        }
        return null
    }

    // ─── Scroll ───────────────────────────────────────────────────────────────

    private fun executeScrollUp(): Boolean {
        val node = findScrollable(service.rootInActiveWindow) ?: return false
        return node.performAction(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)
    }

    private fun executeScrollDown(): Boolean {
        val node = findScrollable(service.rootInActiveWindow) ?: return false
        return node.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
    }

    private fun findScrollable(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        if (node == null) return null
        if (node.isScrollable) return node
        for (i in 0 until node.childCount) {
            val result = findScrollable(node.getChild(i))
            if (result != null) return result
        }
        return null
    }

    // ─── Abrir app ────────────────────────────────────────────────────────────

    private fun executeOpenApp(appName: String): Boolean {
        if (appName.isBlank()) return false
        val pm = service.packageManager
        val apps = pm.getInstalledApplications(0)

        val pkg = apps.firstOrNull { app ->
            pm.getApplicationLabel(app).toString().lowercase().contains(appName.lowercase())
        } ?: run {
            Log.w(TAG, "App no encontrada: $appName")
            return false
        }

        val intent = pm.getLaunchIntentForPackage(pkg.packageName) ?: return false
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        service.startActivity(intent)
        return true
    }

    // ─── Volumen ──────────────────────────────────────────────────────────────

    private fun executeVolumeChange(steps: Int, up: Boolean): Boolean {
        val am = service.getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
        val dir = if (up) android.media.AudioManager.ADJUST_RAISE else android.media.AudioManager.ADJUST_LOWER
        repeat(steps) {
            am.adjustStreamVolume(android.media.AudioManager.STREAM_MUSIC, dir, android.media.AudioManager.FLAG_SHOW_UI)
        }
        return true
    }

    // ─── Captura de pantalla ──────────────────────────────────────────────────

    private fun executeScreenshot(): Boolean {
        val screenshot = ScreenCaptureManager.latestScreenshot ?: return false
        TETRWebSocketClient.instance?.sendScreenshot(screenshot)
        return true
    }

    // ─── Mandar UI tree actualizado al servidor ───────────────────────────────

    private fun sendUpdatedUiTree() {
        try {
            val tree = service.getUiTreeAsText()
            TETRWebSocketClient.instance?.sendUiTree(tree)
        } catch (e: Exception) {
            Log.e(TAG, "Error mandando UI tree: ${e.message}")
        }
    }
}
