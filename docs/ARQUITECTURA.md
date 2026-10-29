# Arquitectura

## Auditoría del entorno inicial (29/10/2026)

- Carpeta de trabajo vacía: no había proyecto previo.
- Disponibles: Node 22.22, npm 10.9, pnpm 10.28, PostgreSQL 16.15, Docker, git, Chromium + Playwright.
- Se fijaron versiones estables y no las recién publicadas: Next.js 15.5 (no 16.x), Prisma 6.19 (el canal `latest` de Prisma apuntaba a una 8.0 *release candidate*).

## Decisión

| Capa | Elección | Motivo |
|---|---|---|
| Aplicación | **Next.js 15 (App Router) + TypeScript** | Tienda pública con SEO y panel en un solo proyecto y un solo despliegue |
| Base de datos | **PostgreSQL** | Transacciones para pagos/stock, restricciones únicas contra duplicados |
| Acceso a datos | **Prisma 6** | Esquema tipado y migraciones versionadas |
| Validación | **zod** | Mismos esquemas para formularios y servidor; toda entrada se valida en el servidor |
| Autenticación | **Propia**: bcrypt + cookie httpOnly con JWT firmado (`jose`) | Un solo rol (administrador), sin dependencia externa; middleware + verificación en cada acción |
| Imágenes | **sharp** + interfaz `Storage` | Original intacto + versión optimizada WEBP 1600px + miniatura 480px |
| Pruebas | **Vitest** (unitarias + integración contra una base de test separada) y Playwright para recorridos manuales |

### Sobre Supabase

Se evaluó. La aplicación usa PostgreSQL estándar, así que **Supabase puede usarse como base de datos administrada sin cambiar código** (cadena `DATABASE_URL`). Se decidió **no** depender de Supabase Auth ni de su SDK:

- Para un único rol administrador, una autenticación propia es menos código y menos piezas que configurar.
- Evita atarse al proveedor: se puede migrar a Neon, Railway o un VPS con `pg_dump`/`pg_restore`.
- El almacenamiento de imágenes está detrás de una interfaz; en la etapa 6 se agrega un driver S3-compatible (Supabase Storage o Cloudflare R2) si el hosting no tiene disco persistente.

Puntos a verificar al elegir hosting (los planes cambian; confirmar precios vigentes): los planes gratuitos de Supabase pausan proyectos inactivos y tienen límites de almacenamiento; el plan gratuito de Vercel no admite uso comercial. Un VPS pequeño con Postgres + disco local es otra opción económica. La decisión se toma en la etapa 6.

## Estructura

```
prisma/schema.prisma        Esquema y migraciones
src/lib/                    Lógica pura, sin base de datos (testeable)
  pricing/engine.ts         Motor de precios
  parser/supplier-message.ts Intérprete de mensajes de WhatsApp
  catalog/matching.ts       Detección de duplicados / identificación de productos
  catalog/publication.ts    Reglas para publicar
  validation/catalog.ts     Esquemas zod compartidos
  auth/session.ts           Firma y verificación de sesión (usado por el middleware)
src/server/                 Servicios con acceso a datos (reglas de negocio + transacciones)
  catalog/products.ts, prices.ts, import.ts, images.ts
  auth.ts, settings.ts, audit.ts, storage/
src/app/admin/              Panel (protegido). actions.ts = acciones de servidor
src/app/media/[...key]      Entrega de imágenes con control de acceso
src/middleware.ts           Protección de /admin y /api/admin
tests/unit, tests/integration
```

Regla: las páginas no contienen reglas de negocio; llaman a servicios de `src/server`, que validan con zod y
ejecutan en transacción. Así las mismas reglas valen para la interfaz, scripts y futuras APIs.

## Convenciones de datos

- **Importes en centavos** (`Int`). `null` significa *dato desconocido*, distinto de `0`.
- **Historiales de solo inserción**: `ProductCostHistory`, `AuditLog`, `PriceChangeProposal`.
- **Bajas lógicas** para imágenes (`deletedAt`): pedidos y publicaciones viejas no se rompen.
- **`isTestData`** en productos, proveedores y mensajes: los datos de prueba no se cuentan en el tablero ni se publicarán.
- Fechas en UTC en la base; se muestran en hora de Argentina.

## Modelo de datos

### Implementado (etapas 1–2)

| Modelo | Propósito |
|---|---|
| `AdminUser`, `LoginAttempt` | Acceso al panel y límite de intentos |
| `AuditLog` | Historial de cambios de cualquier entidad (quién, cuándo, qué cambió, motivo) |
| `Supplier` | Proveedores |
| `SupplierMessage` | Texto original pegado desde WhatsApp, fuente, fecha de consulta, propuesta del intérprete y qué ítems se aplicaron |
| `Product` | Producto general: SKU interno, SKU del proveedor, marca, modelo, costos vigentes, precio publicado, disponibilidad, publicación, fuente/fecha del dato, última consulta, próximo despacho |
| `ProductVariant` | Color × talle, con disponibilidad y fecha de consulta propias. Única por (producto, color normalizado, talle) |
| `ProductImage` | Original + optimizada + miniatura, fuente, autorización, orden, portada |
| `ProductCostHistory` | Cada costo confirmado, con fecha de consulta y mensaje de origen |
| `PriceChangeProposal` | Cambio de costo pendiente: valores y fechas anterior/nuevo, impacto calculado, decisión |
| `PricingSettings` | Costos generales, comisiones, impuestos, objetivo, margen mínimo, redondeo |
| `DispatchSettings`, `Holiday` | Días de despacho (mar/jue/vie), plazo máximo (5 días), feriados |

Estados de disponibilidad: `PENDING_VERIFICATION` (pendiente de verificar), `AVAILABLE_LAST_CHECK` (disponible según última consulta),
`CONFIRMED_FOR_ORDER` (confirmada para un pedido), `SOLD_OUT_CONFIRMED` (agotado confirmado), `DISCONTINUED`. Nunca se marca agotado por falta de información.

### Planificado (etapas 3–5)

| Modelo | Campos clave | Reglas |
|---|---|---|
| `Customer` | nombre, teléfono, canal de origen, notas | Solo los datos necesarios para entregar y contactar |
| `Order` | código único (`LB-AAMM-0001`), cliente, canal, estado, método de entrega, fechas, notas internas, excepción de cierre con saldo (motivo + autorizante) | Estados 1–16 del flujo + `CANCELLED`, `RETURNED`, `INCIDENT` |
| `OrderItem` | producto, variante, **copia** de marca/modelo/color/talle, **precio acordado**, **costo histórico** (copia + `costHistoryId`), gastos, ítem de stock si sale del stock propio | Nunca se recalcula desde el catálogo |
| `OrderStatusChange` | de, a, fecha, usuario, nota | Transiciones validadas por una máquina de estados |
| `Payment` | pedido, importe, método, fecha, referencia, `idempotencyKey` único | Evita registrar dos veces el mismo pago |
| `Shipment` | fechas de consulta, confirmación del proveedor, despacho estimado/confirmado/real, llegada estimada/real, transporte, seguimiento | Estimado y confirmado en campos distintos |
| `Inspection` | ítem, resultado (aprobado/rechazado), observaciones | Sin inspección aprobada no se entrega |
| `Incident` | pedido, tipo (demora, faltante, error de talle…), resolución | Alimenta alertas |
| `InventoryItem` | origen (pedido no retirado, compra), pedido original, variante, recepción, costo total, precio habitual y de oferta, estado, venta (`saleOrderId` único), ingreso | Separado del catálogo; un par solo se vende una vez |
| `CashMovement` | tipo (ingreso, egreso, pago a proveedor, devolución, gasto operativo), importe, fecha, pedido/pago relacionado | Caja real separada de saldos pendientes |
| `ContentPiece` | producto o ítem de stock, canal, formato, texto, CTA, precio, imagen, enlace, fecha prevista, estado | Generado solo con datos vigentes; contenido de stock exige stock físico disponible |

## Seguridad

- `/admin/*` y `/api/admin/*` protegidos por middleware; además cada página y acción llama a `requireAdmin()`.
- Contraseñas con bcrypt (costo 12). Bloqueo de 15 minutos tras 5 intentos fallidos por email. Mensaje de error idéntico exista o no el usuario.
- Cookie `httpOnly`, `sameSite=lax`, `secure` en producción, 12 horas.
- Imágenes: originales solo para administradores; versiones optimizadas públicas solo si están autorizadas y el producto está publicado.
- Validación con zod en el servidor para toda entrada. Claves de almacenamiento validadas contra recorrido de directorios.
- Publicación bloqueada con datos incompletos o margen inválido.
- Copias de seguridad: `pnpm db:backup` (programar diariamente en producción, etapa 6).
