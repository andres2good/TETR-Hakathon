# PLAN DE DESARROLLO — TETR

---

## FASE 1 — Documentación
- [x] README.md
- [x] PLAN.md
- [x] PROGRESO.md
- [x] ARQUITECTURA.md
- [x] STACK.md

---

## FASE 2 — Backend Node.js
- [ ] package.json + .env.example
- [ ] config/env.js + config/constants.js
- [ ] utils/logger.js + utils/retry.js
- [ ] middleware/errorHandler.js + middleware/auth.js
- [ ] stt/deepgram.js — escuchar al usuario
- [ ] llm/claude.js — cerebro con visión
- [ ] llm/prompts/systemPrompt.js — personalidad del agente
- [ ] tts/cartesia.js — voz del agente
- [ ] storage/supabase.js — guardar usuarios e historial
- [ ] session/sessionManager.js — manejo de sesiones activas
- [ ] index.js — servidor WebSocket principal

---

## FASE 3 — App Android (Kotlin)
- [ ] Estructura del proyecto Android
- [ ] AndroidManifest.xml — permisos necesarios
- [ ] AccessibilityService — ver y controlar la pantalla
- [ ] ScreenCapture — capturar pantalla en tiempo real
- [ ] UITreeParser — leer elementos de la pantalla
- [ ] AudioCapture — capturar voz del usuario
- [ ] WebSocketClient — conectar con el backend
- [ ] ActionExecutor — ejecutar acciones (tocar, escribir, deslizar)
- [ ] MainActivity — pantalla de activación de la app

---

## FASE 4 — Pipeline Central
- [ ] Flujo completo: voz → STT → Claude Vision → acción → TTS
- [ ] Manejo de contexto continuo (recuerda la conversación)
- [ ] Detección de intención (qué quiere hacer el usuario)
- [ ] Ejecución de acciones multi-paso
- [ ] Manejo de errores y fallbacks

---

## FASE 5 — Base de Datos
- [ ] database/schema.sql
  - [ ] Tabla users
  - [ ] Tabla sessions
  - [ ] Tabla actions (historial de lo que hizo el agente)
  - [ ] Tabla feedback

---

## FASE 6 — Pruebas
- [ ] Prueba en dispositivo Android real
- [ ] WhatsApp — leer y enviar mensajes
- [ ] Spotify / YouTube — buscar y reproducir
- [ ] Llamadas — marcar y contestar
- [ ] Navegación general entre apps
