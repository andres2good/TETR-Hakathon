package com.tetr.app.accessibility

import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Convierte el árbol de nodos de accesibilidad en texto estructurado
 * que Claude puede entender fácilmente.
 */
object UITreeParser {

    data class UiElement(
        val text: String?,
        val description: String?,
        val className: String,
        val bounds: Rect,
        val isClickable: Boolean,
        val isEditable: Boolean,
        val isScrollable: Boolean,
        val depth: Int,
    )

    fun parse(root: AccessibilityNodeInfo?): String {
        if (root == null) return "(pantalla vacía)"
        val elements = mutableListOf<UiElement>()
        collect(root, elements, 0)

        return buildString {
            elements.forEach { el ->
                val indent = "  ".repeat(el.depth)
                val label = el.text?.takeIf { it.isNotBlank() }
                    ?: el.description?.takeIf { it.isNotBlank() }
                    ?: return@forEach // ignorar nodos sin info útil

                val type = when {
                    el.isEditable -> "campo"
                    el.isClickable -> "botón"
                    el.isScrollable -> "lista"
                    else -> "texto"
                }

                appendLine("$indent[$type] \"$label\" en ${el.bounds}")
            }
        }.trim()
    }

    private fun collect(node: AccessibilityNodeInfo?, list: MutableList<UiElement>, depth: Int) {
        if (node == null) return

        val bounds = Rect()
        node.getBoundsInScreen(bounds)

        list.add(
            UiElement(
                text = node.text?.toString(),
                description = node.contentDescription?.toString(),
                className = node.className?.toString()?.substringAfterLast('.') ?: "View",
                bounds = bounds,
                isClickable = node.isClickable,
                isEditable = node.isEditable,
                isScrollable = node.isScrollable,
                depth = depth,
            )
        )

        for (i in 0 until node.childCount) {
            collect(node.getChild(i), list, depth + 1)
        }
    }
}
