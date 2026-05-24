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
 * Ejecuta las acciones que el agente Claude pide hacer en el celular.
 * Recibe el JSON de la acción y la ejecuta usando el AccessibilityService.
 */
class ActionExecutor(private val service: TETRAccessibilityService) {

    companion object {
        private const val TAG = "ActionExecutor"
    }

    fun execute(actionType: String, params: JSONObject) {
        Log.i(TAG, "Ejecutando: $actionType — $params")

        when (actionType) {
            "click" -> executeClick(params.optString("target"))
            "set_text" -> executeSetText(params.optString("text"), params.optString("target", ""))
            "scroll_up" -> executeScrollUp()
            "scroll_down" -> executeScrollDown()
            "open_app" -> executeOpenApp(params.optString("appName"))
            "press_back" -> service.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK)
            "press_home" -> service.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_HOME)
            "volume_up" -> executeVolumeChange(params.optInt("steps", 2), up = true)
            "volume_down" -> executeVolumeChange(params.optInt("steps", 2), up = false)
            "request_screenshot" -> executeScreenshot()
            else -> Log.w(TAG, "Acción desconocida: $actionType")
        }
    }

    // ─── Click en elemento por texto ─────────────────────────────────────────

    private fun executeClick(target: String) {
        if (target.isBlank()) return

        val node = service.findNodeByText(target)
        if (node != null) {
            if (node.isClickable) {
                node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            } else {
                // Si el nodo en sí no es clickable, buscar el padre clickable
                var parent = node.parent
                while (parent != null) {
                    if (parent.isClickable) {
                        parent.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                        return
                    }
                    parent = parent.parent
                }
                // Último recurso: tap en las coordenadas del nodo
                val bounds = Rect()
                node.getBoundsInScreen(bounds)
                service.tapAt(bounds.centerX().toFloat(), bounds.centerY().toFloat()) {}
            }
        } else {
            Log.w(TAG, "No encontré el elemento: $target")
        }
    }

    // ─── Escribir texto ───────────────────────────────────────────────────────

    private fun executeSetText(text: String, target: String) {
        if (text.isBlank()) return

        // Si hay target, buscar ese campo primero y hacer click
        if (target.isNotBlank()) {
            executeClick(target)
            Thread.sleep(300)
        }

        // Escribir en el campo actualmente enfocado
        val root = service.rootInActiveWindow ?: return
        val focused = findFocusedEditable(root)

        if (focused != null) {
            val args = Bundle()
            args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
            focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        } else {
            Log.w(TAG, "No hay campo de texto activo")
        }
    }

    private fun findFocusedEditable(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        if (node == null) return null
        if (node.isEditable && node.isFocused) return node
        for (i in 0 until node.childCount) {
            val result = findFocusedEditable(node.getChild(i))
            if (result != null) return result
        }
        return null
    }

    // ─── Scroll ───────────────────────────────────────────────────────────────

    private fun executeScrollUp() {
        val root = service.rootInActiveWindow ?: return
        findScrollable(root)?.performAction(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)
    }

    private fun executeScrollDown() {
        val root = service.rootInActiveWindow ?: return
        findScrollable(root)?.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
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

    private fun executeOpenApp(appName: String) {
        if (appName.isBlank()) return

        val pm = service.packageManager
        val apps = pm.getInstalledApplications(0)

        val pkg = apps.firstOrNull { app ->
            pm.getApplicationLabel(app).toString().lowercase().contains(appName.lowercase())
        }

        if (pkg != null) {
            val intent = pm.getLaunchIntentForPackage(pkg.packageName)
            intent?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            service.startActivity(intent)
        } else {
            Log.w(TAG, "App no encontrada: $appName")
        }
    }

    // ─── Volumen ──────────────────────────────────────────────────────────────

    private fun executeVolumeChange(steps: Int, up: Boolean) {
        val audioManager = service.getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
        val direction = if (up) android.media.AudioManager.ADJUST_RAISE else android.media.AudioManager.ADJUST_LOWER
        repeat(steps) {
            audioManager.adjustStreamVolume(
                android.media.AudioManager.STREAM_MUSIC,
                direction,
                android.media.AudioManager.FLAG_SHOW_UI,
            )
        }
    }

    // ─── Captura de pantalla ──────────────────────────────────────────────────

    private fun executeScreenshot() {
        // La MainActivity tiene referencia al ScreenCaptureManager
        val screenshot = ScreenCaptureManager.latestScreenshot
        if (screenshot != null) {
            TETRWebSocketClient.instance?.sendScreenshot(screenshot)
        }
    }
}
