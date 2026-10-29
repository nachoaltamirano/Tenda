# Carga de información recibida por WhatsApp

LOBBY **no lee WhatsApp automáticamente**. No hay acceso a la cuenta del proveedor ni API. La carga es manual y asistida:

```
Mensaje en WhatsApp ──copiar──▶ Importar mensaje ──▶ Propuesta del intérprete ──▶ Revisión humana ──▶ Catálogo
                                 (texto original       (nunca inventa datos)       (corregir, elegir    (cambios de costo
                                  + fecha + fuente)                                 crear/actualizar)    → aprobación)
```

## Situación actual del proveedor

El proveedor publica en un **grupo de WhatsApp** ofertas de stock que está en un **depósito en Argentina** (llega rápido).
Por eso:

- La fuente por defecto al importar es *Grupo de WhatsApp del proveedor*.
- El producto guarda la **oferta**: talles ofrecidos, colores (opcional) y nota de surtido ("Surtidas, sueltas a elección").
  **No se lleva disponibilidad por talle o color**: el cliente consulta, LOBBY confirma con el proveedor y el par puntual
  (talle y color) queda registrado en el pedido (etapa 3).
- El producto queda como **"Disponible según última consulta"**. Un mensaje más reciente reemplaza los talles ofrecidos;
  si no informa colores, se conservan los cargados.
- La fecha de consulta queda visible en el listado y en la ficha; si pasa el umbral configurado (7 días por defecto), el costo se marca como desactualizado.

## Pasos

1. Copiar el mensaje en WhatsApp (mantener presionado → Copiar). Se pueden pegar varios productos juntos.
2. Panel → **Importar mensaje**. Elegir proveedor, origen, fecha de consulta (y, si se conoce, la fecha en que el proveedor lo envió). Pegar y *Interpretar*.
3. Para cada producto detectado, el sistema muestra:
   - el fragmento de texto de origen;
   - **faltantes** (marca, color, talles, precio): quedan vacíos, no se completan;
   - **aclaraciones** (por ejemplo, dos precios distintos): no se elige uno;
   - **advertencias** (rangos de talles expandidos, campos deducidos de texto sin etiqueta, precios sospechosos);
   - **productos parecidos** ya cargados.
4. Corregir los campos, elegir *Crear producto nuevo* o *Actualizar producto existente* y aplicar.
   - Al crear, si hay un producto parecido, hay que confirmar que es distinto.
5. Si el producto existía y el precio cambió, se crea una **propuesta** en *Precios pendientes*. Si el precio es el mismo, solo se renueva la fecha de consulta.

El texto original se conserva siempre, aunque el mensaje se descarte.

## Fotos junto con el mensaje

En *Importar mensaje* se pueden subir las fotos (hasta 40, JPG/PNG/WEBP) junto con el texto. Para que cada foto vaya
sola a su producto, **escribí el nombre del archivo en el mensaje**:

```
Modelo: Nike Air Force 1. Color: blanco. Talles: 38 al 43. Precio: 62000. Fotos: af1.jpg, af1-suela.jpg

• Adidas Campus 00s gris 40 41 42 $70.000 campus.jpg
campus-lateral.jpg            ← una foto en su propia línea va al producto de arriba
```

- Se acepta `Foto:`/`Fotos:`/`Imagen:`/`Archivo:`, o el nombre suelto al final de la línea del producto.
- Los nombres no pueden tener espacios (`af1-blanca.jpg`, no `af1 blanca.jpg`). No distingue mayúsculas; si la extensión
  difiere (`af1.jpg` ↔ `af1.jpeg`) se asigna igual, marcada para revisar.
- La primera foto mencionada es la portada si el producto no tiene una.
- Al revisar, cada producto muestra las miniaturas sugeridas (marcadas) y las fotos que nadie mencionó (sin marcar), para asignarlas a mano.
- Se avisa si el mensaje menciona un archivo que no se subió.
- **Autorización**: las fotos quedan cargadas pero **no publicables** hasta marcar "El proveedor autoriza publicar estas fotos".
- La fuente queda registrada: "Mensaje del proveedor del dd/mm/aaaa · archivo".
- Si el proveedor repite una oferta con la misma foto, no se duplica (se compara el contenido del archivo, no el nombre).
- HEIC (formato de iPhone) no se puede procesar: usar la foto guardada desde WhatsApp, que ya es JPG.

Nombres de archivo: las fotos guardadas desde WhatsApp en Android se llaman como `IMG-20261029-WA0012.jpg`; en iPhone
el nombre no siempre es visible. Lo más práctico es renombrarlas con un código corto (`af1-1.jpg`) al pasarlas a la
computadora, o subirlas sin nombrar y asignarlas a mano en la revisión.

## Formatos que reconoce el intérprete

Con etiquetas (recomendado, una línea o varias):

```
Modelo: modelo de ejemplo. Color: negro. Talles: 39, 40, 41 y 42. Precio: 45000. Despacho: jueves.
```

Etiquetas: `Modelo`, `Marca`, `Color(es)`, `Talle(s)`/`Numeración`/`Curva`, `Precio`/`Valor`/`Costo`, `SKU`/`Código`, `Despacho`/`Envío`, `Stock`, `Obs`/`Nota`.
Una nueva etiqueta `Modelo:` dentro del mismo mensaje empieza otro producto.

Listas de ofertas sin etiquetas (una línea por producto, **con `$`**):

```
🔥 OFERTAS STOCK EN DEPÓSITO 🔥
• Nike Air Force 1 blancas 38 al 43 $62.000
• Adidas Campus 00s gris 40 41 42 $70.000
```

- Talles: listas (`39, 40 y 41`), rangos (`38 al 43`, `39-42`) y medios talles (`40.5`, `40½`). Los rangos se expanden a talles enteros con una advertencia.
- Precios: `45000`, `45.000`, `$ 45.000,50`, `45k` (con advertencia), `USD 60`.
- Despacho: día de la semana o fecha `dd/mm`. Siempre queda como **estimado** hasta confirmarlo.
- Formato del grupo del proveedor (verificado con un mensaje real del 29/10/2026): etiquetas pegadas a emojis (`👣Talles: 38 al 43`),
  precio en línea suelta (`💰$40.900 c/par`), `Surtidas (sueltas a elección)` → nota de surtido (no se inventan colores),
  `Calidad …` → notas, `DEPOSITO #2` → origen del stock.
- Marca: se separa del modelo si empieza con una marca conocida (Nike, Adidas, Puma, New Balance, Vans, Converse, etc.).
- Encabezados como "OFERTAS", "STOCK", "LLEGÓ" y líneas sin precio se ignoran y se listan para revisarlas.

Los formatos reales del grupo pueden diferir: con 3 o 4 mensajes reales de ejemplo se ajusta el intérprete y se agregan como pruebas.
