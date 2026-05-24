# ARQUITECTURA TÉCNICA — TETR

## Flujo completo de una interacción

```
USUARIO HABLA
     │
     ▼
┌─────────────────────────────────┐
│  APP ANDROID                    │
│  - Micrófono captura la voz     │
│  - Captura screenshot de        │
│    la pantalla actual           │
│  - Lee el UI Tree               │
│    (lista de elementos          │
│    visibles en pantalla)        │
└────────────┬────────────────────┘
             │ WebSocket: audio + screenshot + UI tree
             ▼
┌─────────────────────────────────┐
│  BACKEND Node.js                │
│                                 │
│  1. Deepgram Nova-3             │
│     Convierte voz a texto       │
│     ~200ms                      │
│                                 │
│  2. Claude Sonnet 4.6 Vision    │
│     - Recibe: texto del usuario │
│       + screenshot + UI tree    │
│       + historial conversación  │
│     - Entiende qué quiere hacer │
│     - Decide la acción          │
│     - Genera respuesta verbal   │
│     ~300-400ms                  │
│                                 │
│  3. Cartesia Sonic-3            │
│     Convierte respuesta a voz   │
│     ~40ms                       │
└────────────┬────────────────────┘
             │ WebSocket: audio de respuesta + acción a ejecutar
             ▼
┌─────────────────────────────────┐
│  APP ANDROID                    │
│  - Reproduce la voz al usuario  │
│  - Ejecuta la acción:           │
│    · Tocar botón                │
│    · Escribir texto             │
│    · Abrir app                  │
│    · Deslizar pantalla          │
│    · Ajustar volumen            │
└─────────────────────────────────┘

LATENCIA TOTAL: < 1 segundo
```

---

## Cómo la app ve la pantalla

### Método 1: UI Tree (rápido, para acciones)
Android expone todos los elementos de la pantalla como texto estructurado.
Ejemplo de lo que ve TETR en WhatsApp:

```
App: WhatsApp
Elementos:
  - Barra superior: "WhatsApp"
  - Lista de chats:
    - "María García" — "Hola! ¿cómo estás?" — 10:30am — 2 no leídos
    - "Mamá" — "¿Ya comiste?" — 10:15am — 1 no leído
    - "Trabajo" — "Reunión mañana 9am" — ayer
  - Botón: "Nueva conversación" (esquina inferior derecha)
```

Esto se lo mandamos a Claude en texto y él decide qué hacer.

### Método 2: Screenshot + Vision (para contenido visual)
Cuando hay imágenes, fotos, PDFs o contenido que no se puede leer como texto,
tomamos una captura de pantalla y se la mandamos a Claude Vision.

Claude responde describiendo lo que ve: "Es una foto de una playa con palmeras".

---

## Qué acciones puede ejecutar

| Acción | Cómo se hace en Android |
|--------|------------------------|
| Tocar un botón | AccessibilityService.performAction(CLICK) |
| Escribir texto | AccessibilityService.performAction(SET_TEXT) |
| Deslizar arriba/abajo | AccessibilityService.performGesture() |
| Abrir una app | Intent con el nombre del paquete |
| Presionar Atrás | AccessibilityService.performGlobalAction(BACK) |
| Ir a Inicio | AccessibilityService.performGlobalAction(HOME) |
| Subir/bajar volumen | AudioManager |

---

## Por qué WebSocket entre la app y el backend

La voz llega en tiempo real — no podemos esperar a que el usuario termine
de hablar para empezar a procesar. Con WebSocket el audio fluye
continuamente desde el celular al backend, igual que en EZAI.

---

## Limitaciones conocidas

**Apps bancarias y streaming:** Bloquean capturas de pantalla por seguridad.
Para estas apps, TETR solo puede usar el UI Tree (sin screenshot).

**Acciones muy específicas de cada app:** Algunas apps tienen flujos
complejos que necesitan ser mapeados manualmente para funcionar bien.

**Requiere internet:** Todo el procesamiento de IA está en el backend.
Sin internet, la app no funciona.
