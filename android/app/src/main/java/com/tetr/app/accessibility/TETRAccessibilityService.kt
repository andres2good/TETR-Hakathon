package com.tetr.app.accessibility

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.tetr.app.websocket.TETRWebSocketClient
import com.tetr.app.actions.ActionExecutor

/**
 * Servicio de accesibilidad — el corazón de TETR.
 * Tiene acceso completo a todos los elementos de cualquier app en pantalla.
 * También ejecuta las acciones que pide el agente (tocar, escribir, etc.)
 */
class TETRAccessibilityService : AccessibilityService() {

    companion object {
        var instance: TETRAccessibilityService? = null
            private set
        private const val TAG = "TETRAccessibility"
    }

    val actionExecutor by lazy { ActionExecutor(this) }

    override fun onServiceConnected() {
        instance = this
        Log.i(TAG, "Servicio de accesibilidad conectado")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Cada vez que cambia la pantalla, mandamos el UI tree actualizado
        if (event?.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
            event?.eventType == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
            sendUiTreeToServer()
        }
    }

    override fun onInterrupt() {
        Log.w(TAG, "Servicio interrumpido")
    }

    override fun onDestroy() {
        instance = null
        super.onDestroy()
    }

    // ─── Leer la pantalla ─────────────────────────────────────────────────────

    fun getUiTreeAsText(): String {
        val root = rootInActiveWindow ?: return "(pantalla vacía)"
        val sb = StringBuilder()
        traverseNode(root, sb, 0)
        return sb.toString().trim()
    }

    private fun traverseNode(node: AccessibilityNodeInfo?, sb: StringBuilder, depth: Int) {
        if (node == null) return

        val indent = "  ".repeat(depth)
        val bounds = Rect()
        node.getBoundsInScreen(bounds)

        val parts = mutableListOf<String>()

        if (!node.text.isNullOrBlank()) parts.add("text=\"${node.text}\"")
        if (!node.contentDescription.isNullOrBlank()) parts.add("desc=\"${node.contentDescription}\"")
        if (!node.viewIdResourceName.isNullOrBlank()) parts.add("id=\"${node.viewIdResourceName}\"")
        if (node.isClickable) parts.add("clickable")
        if (node.isEditable) parts.add("editable")
        if (node.isChecked) parts.add("checked")
        if (node.isScrollable) parts.add("scrollable")

        val className = node.className?.toString()?.substringAfterLast('.') ?: ""
        if (parts.isNotEmpty() || depth == 0) {
            sb.appendLine("$indent[$className] ${parts.joinToString(" ")} bounds=$bounds")
        }

        for (i in 0 until node.childCount) {
            traverseNode(node.getChild(i), sb, depth + 1)
        }
    }

    // ─── Encontrar nodo por texto ─────────────────────────────────────────────

    fun findNodeByText(text: String): AccessibilityNodeInfo? {
        val root = rootInActiveWindow ?: return null
        return findNode(root, text)
    }

    private fun findNode(node: AccessibilityNodeInfo?, query: String): AccessibilityNodeInfo? {
        if (node == null) return null
        val nodeText = node.text?.toString()?.lowercase() ?: ""
        val nodeDesc = node.contentDescription?.toString()?.lowercase() ?: ""
        val q = query.lowercase()

        if (nodeText.contains(q) || nodeDesc.contains(q)) return node

        for (i in 0 until node.childCount) {
            val result = findNode(node.getChild(i), query)
            if (result != null) return result
        }
        return null
    }

    // ─── Tap en coordenadas ───────────────────────────────────────────────────

    fun tapAt(x: Float, y: Float, onDone: (Boolean) -> Unit) {
        val path = Path().apply { moveTo(x, y) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 50))
            .build()
        dispatchGesture(gesture, object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription) = onDone(true)
            override fun onCancelled(gestureDescription: GestureDescription) = onDone(false)
        }, null)
    }

    // ─── Scroll ───────────────────────────────────────────────────────────────

    fun scrollUp() = performGlobalAction(GLOBAL_ACTION_ACCESSIBILITY_ALL_WINDOWS)

    fun scrollDown() {
        rootInActiveWindow?.let { node ->
            node.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
        }
    }

    // ─── Enviar UI tree al servidor ───────────────────────────────────────────

    private fun sendUiTreeToServer() {
        val tree = getUiTreeAsText()
        TETRWebSocketClient.instance?.sendUiTree(tree)
    }
}
