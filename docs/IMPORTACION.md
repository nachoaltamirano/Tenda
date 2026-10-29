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
- Los talles informados quedan como **"Disponible según última consulta"**, no como confirmados: una oferta del grupo es general
  y puede agotarse. La confirmación para un pedido concreto se registra aparte (etapa 3).
- Los talles que **no** figuran en un mensaje nuevo **no** se marcan como agotados.
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
   - Con varios colores hay que confirmar que todos los talles existen en todos los colores (si no, cargarlos por separado).
   - Al crear, si hay un producto parecido, hay que confirmar que es distinto.
5. Si el producto existía y el precio cambió, se crea una **propuesta** en *Precios pendientes*. Si el precio es el mismo, solo se renueva la fecha de consulta.

El texto original se conserva siempre, aunque el mensaje se descarte.

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
- Marca: se separa del modelo si empieza con una marca conocida (Nike, Adidas, Puma, New Balance, Vans, Converse, etc.).
- Encabezados como "OFERTAS", "STOCK", "LLEGÓ" y líneas sin precio se ignoran y se listan para revisarlas.

Los formatos reales del grupo pueden diferir: con 3 o 4 mensajes reales de ejemplo se ajusta el intérprete y se agregan como pruebas.
