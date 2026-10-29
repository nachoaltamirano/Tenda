# LOBBY — sistema operativo de e-commerce

Aplicación para operar LOBBY: catálogo del proveedor, precios y rentabilidad, pedidos por encargo,
stock propio, caja, tienda pública y contenido para redes.

**Estado actual: Etapas 1 y 2 terminadas; etapa 3 (pedidos y caja) funcional, falta stock propio.** Ver [docs/PLAN.md](docs/PLAN.md) para el detalle de lo terminado y lo pendiente.

| Documento | Contenido |
|---|---|
| [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) | Decisiones técnicas, modelo de datos (actual y futuro), seguridad |
| [docs/IMPORTACION.md](docs/IMPORTACION.md) | Cómo cargar la información que llega por WhatsApp |
| [docs/PRECIOS.md](docs/PRECIOS.md) | Fórmulas del motor de precios y datos necesarios |
| [docs/PLAN.md](docs/PLAN.md) | Etapas, tareas y estado |
| [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md) | Publicar en Vercel + Supabase y conectar un dominio |

## Requisitos

- Node.js 22 y pnpm 10
- PostgreSQL 15 o superior (local, Supabase, Neon u otro)

## Instalación

```bash
pnpm install
cp .env.example .env        # completar DATABASE_URL, TEST_DATABASE_URL y SESSION_SECRET
pnpm db:deploy              # aplica las migraciones
pnpm db:seed                # crea la configuración inicial y el proveedor principal (sin productos)
pnpm admin:create tu@email.com "Tu nombre"   # pide la contraseña (mín. 10 caracteres)
pnpm dev                    # http://localhost:3000/admin
```

Para generar `SESSION_SECRET`: `openssl rand -base64 48`.

Opcional en desarrollo: `pnpm db:seed:demo` crea dos productos de demostración marcados como prueba
(`[DEMO]`, `isTestData = true`). No aparecen en el tablero ni podrán aparecer en la tienda.

## Variables de entorno

| Variable | Uso |
|---|---|
| `DATABASE_URL` | Base de datos principal |
| `TEST_DATABASE_URL` | Base exclusiva para pruebas. Las pruebas **vacían** esta base; nunca apuntarla a datos reales |
| `SESSION_SECRET` | Firma de la cookie de sesión del panel (≥ 32 caracteres) |
| `DIRECT_URL` | Conexión directa para migraciones (local: igual a `DATABASE_URL`) |
| `STORAGE_DRIVER` | `local` (carpeta) o `s3` (Supabase Storage; obligatorio en Vercel) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Almacenamiento S3 |
| `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_INITIAL_PASSWORD` | Primer administrador al desplegar (si no hay ninguno) |
| `STORAGE_LOCAL_DIR` | Carpeta de imágenes (por defecto `./storage`) |
| `PUBLIC_SITE_URL` | URL pública de la tienda (enlaces de WhatsApp y SEO, etapa 4) |
| `PUBLIC_WHATSAPP_NUMBER` | Número de WhatsApp Business (etapa 4) |

Ninguna variable se expone al navegador.

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Desarrollo / compilación / producción |
| `pnpm test` | Aplica migraciones a la base de test y corre todas las pruebas |
| `pnpm test:unit` | Solo pruebas sin base de datos |
| `pnpm lint` | Verificación de tipos |
| `pnpm db:migrate` | Crea una migración nueva (desarrollo) |
| `pnpm db:deploy` | Aplica migraciones (producción) |
| `pnpm db:backup` | Copia de seguridad con `pg_dump` en `backups/` (conserva las últimas 30) |
| `pnpm admin:create` | Crea o actualiza un administrador |

## Uso diario (lo disponible hoy)

1. **Configuración → Motor de precios**: cargar comisiones, impuestos, costos generales, margen objetivo y mínimo. Hasta hacerlo, el panel avisa que los precios sugeridos no son confiables.
2. **Importar mensaje**: pegar el texto del grupo o del chat del proveedor, revisar cada producto propuesto y aplicarlo. Ver [docs/IMPORTACION.md](docs/IMPORTACION.md).
3. **Productos**: ver costo, precio sugerido, margen, recargo y fecha de última consulta. Las filas amarillas tienen el costo desactualizado.
4. **Ficha del producto → Actualizar precio**: registrar un costo nuevo. Nunca se aplica directo: genera una propuesta.
5. **Precios pendientes**: comparar antes/después y aprobar (manteniendo el precio, usando el sugerido u otro) o rechazar.
6. **Fotos**: subir varias, ordenarlas, elegir portada, indicar la fuente y si están autorizadas para publicar.
7. **Publicar**: solo se permite con costo, precio, talles, foto autorizada y margen válido.
8. **Pedidos**: crear el pedido cuando alguien consulta (desde la ficha del producto o *Crear pedido*). Elegir talle y color,
   consultar al proveedor y *Registrar confirmación del proveedor* (calcula despacho y llegada estimados), luego
   *Pedido confirmado* → *Registrar compra* → *Marcar recibido* → inspección → cobro → entrega → *Cerrado*.
   La tarjeta *Avanzar el pedido* muestra qué falta para cada paso.
9. **Caja**: cobrado, pagado, saldos a cobrar, capital comprometido y ganancia real. Los gastos generales se cargan ahí;
   los de un pedido, desde el pedido.
