# Base de Datos — TETR

## Cómo configurar Supabase

1. Ve a [supabase.com](https://supabase.com) y crea un proyecto nuevo
2. En el menú izquierdo abre **SQL Editor**
3. Haz clic en **New query**
4. Pega todo el contenido de `schema.sql`
5. Haz clic en **Run**

## Obtener las claves para el .env

En Supabase → **Settings** → **API**:

```
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...  (la clave "service_role", NO la "anon")
```

## Tablas creadas

| Tabla | Para qué sirve |
|-------|----------------|
| `users` | Un registro por celular (identificado por deviceId) |
| `sessions` | Cada vez que el usuario abre la app = 1 sesión |
| `actions` | Historial completo: qué dijo, qué hizo el agente |
| `feedback` | (Futuro) El usuario califica si el agente se equivocó |

## Vistas útiles

- `user_stats` — resumen de actividad por usuario
- `top_actions` — qué acciones usa más la gente

## Notas de seguridad

- RLS activado en todas las tablas
- El backend usa `service_role_key` que bypasa RLS (correcto, es el servidor)
- La app Android **nunca** accede a Supabase directamente — todo pasa por el servidor
