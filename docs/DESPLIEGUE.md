# Despliegue en Vercel + Supabase

La app se publica en Vercel (servidor) y usa Supabase para la base de datos PostgreSQL y las fotos.
Cada `git push` a `main` vuelve a desplegar automáticamente. El build aplica las migraciones pendientes
y crea la configuración inicial (`pnpm build:deploy`, definido en `vercel.json`).

Las claves se cargan **solo** en Vercel (Settings → Environment Variables). No se escriben en el código ni en el chat.

## 1. Supabase (base de datos y fotos)

1. Crear una cuenta en https://supabase.com y un proyecto nuevo:
   - Región: **South America (São Paulo)**, cerca de Argentina y de la región de Vercel elegida (`gru1`).
   - Anotar la contraseña de la base de datos.
2. **Base de datos**: botón *Connect* → pestaña *ORMs* → *Prisma*. Copiar:
   - `DATABASE_URL`: la del **Transaction pooler** (puerto 6543), terminada en `?pgbouncer=true&connection_limit=1`.
   - `DIRECT_URL`: la del **Session pooler** (puerto 5432). Se usa para las migraciones.
   - Reemplazar `[YOUR-PASSWORD]` por la contraseña del paso 1.
3. **Fotos**: menú *Storage* → *New bucket* → nombre `lobby-media`, **sin** marcar "Public bucket".
4. **Acceso S3 a las fotos**: *Storage* → *Settings* (o *S3 Connection*):
   - Copiar **Endpoint** y **Region**.
   - *New access key* → copiar **Access key ID** y **Secret access key** (el secreto se muestra una sola vez).

## 2. Vercel (servidor)

1. Entrar a https://vercel.com con la cuenta de GitHub → *Add New… → Project* → importar `nachoaltamirano/Tenda`.
2. Antes de *Deploy*, en *Environment Variables* cargar:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | Transaction pooler de Supabase (paso 1.2) |
| `DIRECT_URL` | Session pooler de Supabase (paso 1.2) |
| `SESSION_SECRET` | Texto aleatorio de 48+ caracteres (generarlo con un gestor de contraseñas). Si cambia, se cierran todas las sesiones |
| `STORAGE_DRIVER` | `s3` |
| `S3_ENDPOINT` | Endpoint de Supabase Storage (paso 1.4) |
| `S3_REGION` | Region de Supabase Storage (paso 1.4) |
| `S3_BUCKET` | `lobby-media` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Claves del paso 1.4 |
| `ADMIN_EMAIL` / `ADMIN_NAME` | Tu email y nombre para entrar al panel |
| `ADMIN_INITIAL_PASSWORD` | Contraseña inicial (10+ caracteres). Solo se usa si todavía no hay administradores |
| `PUBLIC_SITE_URL` | La URL que asigne Vercel (ej. `https://tenda.vercel.app`); después, el dominio propio |

3. *Deploy*. Al terminar, el panel queda en `https://<proyecto>.vercel.app/admin`.
4. Después del primer despliegue, borrar `ADMIN_INITIAL_PASSWORD` de Vercel (el administrador ya existe).

## 3. Dominio propio (cuando lo tengas)

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
