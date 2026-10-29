# Plan de implementación

Leyenda: ✅ terminado y probado · 🟡 parcial · ⬜ pendiente

## Etapa 1 — Auditoría, arquitectura y esquema ✅

- ✅ Auditoría del entorno y elección de versiones estables
- ✅ Proyecto Next.js + TypeScript + Prisma + PostgreSQL
- ✅ Esquema de catálogo, proveedor, precios, configuración, auditoría (migración `init_catalog_pricing`)
- ✅ Modelo de datos de etapas 3–5 definido (ver ARQUITECTURA.md)
- ✅ Autenticación del panel, middleware, límite de intentos
- ✅ Base de pruebas separada, scripts de semilla, alta de administrador y copia de seguridad

## Etapa 2 — Catálogo, importación asistida y actualización de precios 🟡 (base funcional)

| Tarea | Estado | Verificación |
|---|---|---|
| Motor de precios (costo total, sugerido con comisiones, margen, recargo, redondeo, faltantes) | ✅ | `tests/unit/pricing.test.ts` |
| Alta/edición de productos con variantes color × talle | ✅ | `tests/integration/products.test.ts` |
| Detección de duplicados (nombre normalizado, SKU proveedor, similitud) | ✅ | `matching.test.ts`, `products.test.ts` |
| Historial de modificaciones de cada producto | ✅ | `products.test.ts` |
| Intérprete de mensajes (etiquetado, una línea, ofertas de grupo, ambigüedades) | ✅ | `tests/unit/parser.test.ts` |
| Importación: guardar original → revisar → crear/actualizar | ✅ | `tests/integration/import.test.ts` + prueba en navegador |
| Propuestas de precio: anterior/nuevo, fechas, impacto, aprobación, historial | ✅ | `tests/integration/prices.test.ts` + prueba en navegador |
| Bloqueo de margen bajo el mínimo sin confirmación | ✅ | `products.test.ts`, `prices.test.ts` |
| Fotos: varias, orden, portada, fuente, autorización, original privado, baja lógica | ✅ | prueba en navegador |
| Reglas de publicación (datos completos, foto autorizada, margen) | ✅ | `products.test.ts` |
| Panel: listado con filtros, ficha, precios pendientes, importación, configuración | ✅ | build + recorrido con Playwright |
| Fotos subidas con el mensaje y asignadas por nombre de archivo (sin duplicados, autorización explícita) | ✅ | `import-photos.test.ts`, `parser.test.ts`, `photo-matching.test.ts` + navegador |
| Ajustar el intérprete con mensajes reales del grupo | ⬜ | requiere ejemplos reales |
| Importación de listas en archivo (CSV/Excel) | ⬜ | si el proveedor envía listas |
| Comparación masiva de una lista completa contra el catálogo | ⬜ | hoy se revisa ítem por ítem |

## Etapa 3 — Pedidos, despacho, stock y caja ⬜

1. Migración: `Customer`, `Order`, `OrderItem`, `OrderStatusChange`, `Payment`, `Shipment`, `Inspection`, `Incident`.
2. Máquina de estados de pedidos (16 estados + cancelación, devolución, incidencia) con pruebas de cada transición prohibida.
3. Copia de precio acordado y costo histórico en `OrderItem`; prueba de que una actualización de catálogo no los modifica.
4. Pagos con clave de idempotencia; saldo pendiente; cierre con excepción autorizada.
5. Calendario de despacho: próxima fecha según días configurados, feriados, plazo; estimado vs. confirmado; demoras.
6. Inspección obligatoria antes de entregar; entrega con método y fecha obligatorios.
7. Stock propio (`InventoryItem`) separado del catálogo; venta única por par (restricción en base + prueba de concurrencia).
8. Caja (`CashMovement`): cobrado, pagado, pendiente, ganancia real.
9. Alertas: pedidos demorados, cambios de precio, faltantes, pagos pendientes, entregas sin coordinar.
10. Tablero completo (capital comprometido, en tránsito, atrasados, caja, stock, publicaciones pendientes).

## Etapa 4 — Tienda pública ⬜

Inicio, catálogo con búsqueda y filtros (talle, color, marca, precio), ficha con galería y variantes, por encargo vs. disponible,
plazo estimado, botón de WhatsApp con mensaje precompletado (producto, talle, color, URL), ofertas de stock, cómo comprar, preguntas
frecuentes, contacto, políticas. Metadatos, sitemap, URLs amigables. Solo productos publicados y no marcados como prueba.

## Etapa 5 — Contenido para redes ⬜

Generador por canal (Instagram, Marketplace, WhatsApp) y formato (publicación, historia, guion de reel, promo de fin de semana,
aviso de llegada, respuesta, seguimiento, catálogo de WhatsApp) con datos vigentes; copiar/descargar; estados; calendario semanal.

## Etapa 6 — Pruebas, documentación y despliegue ⬜

Driver de almacenamiento S3-compatible si el hosting no tiene disco persistente, copias programadas, cabeceras de seguridad,
pruebas de extremo a extremo automatizadas, guía de despliegue y restauración.
