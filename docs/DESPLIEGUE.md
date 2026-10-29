# Despliegue en Vercel + Supabase

La app se publica en Vercel (servidor) y usa Supabase para la base de datos PostgreSQL y las fotos.
Cada `git push` a `main` vuelve a desplegar automáticamente. El build aplica las migraciones pendientes
y crea la configuración inicial (`pnpm build:deploy`, definido en `vercel.json`).

Las claves se cargan **solo** en Vercel (Settings → Environment Variables). No se escriben en el código ni en el chat.

## Camino recomendado: integración Vercel–Supabase

El proyecto de Supabase **`lobby`** (región São Paulo, `sa-east-1`) ya está creado dentro de la cuenta de Supabase
vinculada a Vercel, con el espacio privado de fotos `lobby-media`. Al conectarlo al proyecto de Vercel, la integración
carga sola las variables de base de datos y de Storage (`POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`,
`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, …) y la app las usa sin configuración adicional.

1. https://vercel.com → *Add New… → Project* → importar `nachoaltamirano/Tenda`. Si el primer despliegue falla por falta
   de base de datos, es normal: se conecta en el paso 2.
2. En el proyecto de Vercel: pestaña **Storage** → *Connect Database* → elegir el proyecto de Supabase **`lobby`** → *Connect*.
3. *Settings → Environment Variables* → agregar solo estas:

| Variable | Valor |
|---|---|
| `SESSION_SECRET` | Texto aleatorio de 48+ caracteres (generarlo con un gestor de contraseñas). Si cambia, se cierran todas las sesiones |
| `ADMIN_EMAIL` / `ADMIN_NAME` | Tu email y nombre para entrar al panel |
| `ADMIN_INITIAL_PASSWORD` | Contraseña inicial (10+ caracteres). Solo se usa si todavía no hay administradores |

4. *Deployments* → último despliegue → *Redeploy*. El build aplica las migraciones, crea el administrador y publica.
   El panel queda en `https://<proyecto>.vercel.app/admin`.
5. Después del primer despliegue, borrar `ADMIN_INITIAL_PASSWORD` de Vercel.

## Alternativa: configuración manual

Si no se usa la integración: definir `DATABASE_URL` (Transaction pooler de Supabase, puerto 6543, con
`?pgbouncer=true&connection_limit=1`), `DIRECT_URL` (Session pooler, puerto 5432), y para las fotos `SUPABASE_URL`
+ `SUPABASE_SECRET_KEY` (Supabase → *Project Settings → API Keys*), o bien `STORAGE_DRIVER=s3` con las claves S3 de
*Storage → Settings*. Las variables definidas a mano tienen prioridad sobre las de la integración.

## Seguridad de la base en Supabase

La app accede a la base solo desde el servidor. La migración `supabase_lockdown` activa RLS y quita permisos a los roles
`anon` y `authenticated`, para que la API pública de Supabase no exponga ninguna tabla. El espacio de fotos es privado:
las imágenes se entregan a través de la app, que controla qué se puede ver.

## Dominio propio (cuando lo tengas)

Vercel → proyecto → *Settings → Domains* → agregar el dominio y cargar en el registrador (por ejemplo NIC Argentina)
los registros DNS que indique Vercel. Actualizar `PUBLIC_SITE_URL`.

## Límites a tener en cuenta

Verificar los planes vigentes antes de vender; cambian seguido.

- **Vercel Hobby (gratis)** es solo para uso no comercial. Para operar la tienda corresponde el plan Pro.
- **Supabase gratis** pausa los proyectos sin actividad durante una semana y tiene límites de base y almacenamiento.
  Para operación real conviene el plan pago o hacer copias frecuentes.
- **Fotos**: Vercel acepta hasta ~4,5 MB por envío. El navegador reduce las fotos pesadas a 2000 px antes de subirlas;
  si un lote supera 4 MB, se pide subirlo en tandas. Las fotos de WhatsApp suelen pesar menos de 0,5 MB.
- **Copias de seguridad**: `pnpm db:backup` con `DATABASE_URL` apuntando a la `DIRECT_URL` de Supabase genera un respaldo local.
