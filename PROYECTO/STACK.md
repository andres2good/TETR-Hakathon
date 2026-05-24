# STACK TECNOLÓGICO — TETR

## Backend

### Node.js + Express + WebSocket
El servidor que coordina todo. La app Android se conecta aquí.
Recibe audio y screenshots, los procesa con IA, devuelve voz y acciones.

### Deepgram Nova-3 (STT)
Convierte la voz del usuario a texto en tiempo real.
Misma integración que EZAI — ya está probada.
Costo: ~$0.004 USD/minuto.

### Claude Sonnet 4.6 con Vision
El cerebro. Recibe el texto del usuario + la descripción de la pantalla
(o screenshot) y decide qué responder y qué acción ejecutar.
La diferencia con EZAI: aquí Claude también puede ver imágenes (Vision).
Costo: ~$0.02 USD por conversación.

### Cartesia Sonic-3 (TTS)
Convierte la respuesta de Claude en voz natural.
Misma integración que EZAI.
Costo: ~$0.002 USD por respuesta.

### Supabase
Guarda usuarios, sesiones e historial de acciones.
Gratis para empezar.

---

## App Android

### Kotlin
Lenguaje oficial de Android. Moderno y bien documentado.

### Android Accessibility Service
El permiso más importante. Le da a TETR acceso completo para:
- Leer todos los elementos de la pantalla
- Ejecutar acciones (tocar, escribir, deslizar)
- Recibir notificaciones de cambios en pantalla
Es el mismo mecanismo que usa TalkBack (el lector de pantalla de Google).

### MediaProjection API
Permite tomar capturas de pantalla para mandárselas a Claude Vision.
Requiere que el usuario acepte una vez al iniciar.

### AudioRecord
Captura el audio del micrófono en tiempo real para mandarlo a Deepgram.

### OkHttp WebSocket
Librería para la conexión WebSocket entre la app y el backend.

---

## Costo total estimado por usuario activo

| Servicio | Uso estimado/mes | Costo |
|---------|-----------------|-------|
| Deepgram | 60 min/día × 30 días | ~$7 USD |
| Claude Vision | 200 interacciones/día × 30 | ~$12 USD |
| Cartesia | 200 respuestas/día × 30 | ~$1 USD |
| Supabase | Free tier | $0 |
| **Total** | | **~$20 USD/usuario/mes** |

Precio sugerido de suscripción: $149 pesos/mes (~$7.5 USD)
Con volumen, el costo de IA baja significativamente.

---

## Reusar de EZAI

El 60% del backend es idéntico a EZAI:
- Config, utils, middleware, logger, retry → copy/paste directo
- Deepgram, Cartesia → misma integración, diferente contexto
- Claude → mismo cliente, diferente system prompt y tools

Lo nuevo:
- System prompt orientado a control de dispositivo, no recepcionista
- Sin Google Calendar, sin Telnyx
- Session manager para múltiples usuarios simultáneos
- Recibir y procesar screenshots (nuevo)
