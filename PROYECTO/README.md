# TETR — Asistente de IA para Personas Ciegas

## ¿Qué es TETR?

TETR es una app Android que controla el celular completo por voz usando inteligencia artificial.
El usuario habla, TETR escucha, ve la pantalla y hace lo que le piden — como tener una persona
que maneja el celular por ti.

Diseñado principalmente para personas ciegas o con baja visión, adultos mayores,
y personas con movilidad reducida.

---

## ¿Cómo funciona en la vida real?

El usuario descarga la app, activa un permiso de accesibilidad, y desde ese momento
puede controlar todo el celular hablando:

**Mensajería**
- "Mándale un WhatsApp a Juan que voy tarde"
- "Léeme mis mensajes"
- "Contéstale que sí"

**Música y entretenimiento**
- "Pon música relajante en Spotify"
- "Pausa la canción"
- "Busca videos de cocina en YouTube"

**Llamadas**
- "Llámale a mamá"
- "¿Quién me llamó hoy?"

**Cualquier app**
- "Abre mi banco y dime el saldo"
- "Pide un Uber a mi casa"
- "Manda un correo a mi jefe"

**Sistema**
- "Sube el volumen"
- "¿Cuánta batería tengo?"
- "Activa el WiFi"

---

## Arquitectura en una línea

```
Usuario habla → Deepgram (voz→texto) → Claude Vision (ve pantalla + piensa) → Cartesia (texto→voz) → Android ejecuta la acción
```

Todo en menos de 1 segundo.

---

## Stack Tecnológico

| Componente | Tecnología | Función |
|-----------|-----------|---------|
| App Android | Kotlin + Accessibility Service | Controla el celular, captura pantalla |
| Backend | Node.js + Express + WebSocket | Coordina todos los servicios de IA |
| STT | Deepgram Nova-3 | Escucha al usuario en tiempo real |
| Cerebro | Claude Sonnet 4.6 Vision | Ve la pantalla y decide qué hacer |
| TTS | Cartesia Sonic-3 | Le habla al usuario con voz natural |
| Base de datos | Supabase | Usuarios, historial, preferencias |

---

## Estructura del Proyecto

```
tetr-hakathon/
├── PROYECTO/        ← Documentación (estás aquí)
├── server/          ← Backend Node.js
├── android/         ← App Kotlin para Android
└── database/        ← Schema de Supabase
```

---

## Para quién es

| Usuario | Por qué lo necesita |
|---------|-------------------|
| Personas ciegas | No pueden ver la pantalla |
| Baja visión | Difícil leer texto pequeño |
| Adultos mayores | Les cuesta navegar apps |
| Movilidad reducida | No pueden tocar fácilmente |
| Manos ocupadas | Manejando, cocinando, cargando cosas |

---

## Diferencia con Siri / Google Assistant

| | Siri / Google | TETR |
|--|--------------|------|
| Conversación natural | Limitada | Total — recuerda contexto |
| Control de cualquier app | No | Sí |
| Describe lo que hay en pantalla | No | Sí |
| Flujos de varios pasos | No | Sí |
| Español mexicano natural | Básico | Muy natural |

---

Proyecto iniciado: Mayo 2026
