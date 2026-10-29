# Motor de precios

Código: `src/lib/pricing/engine.ts` (funciones puras, cubiertas por `tests/unit/pricing.test.ts`).

## Fórmulas

```
Costo fijo (C)    = proveedor + transporte + embalaje + envío asumido + accesorios + otros + comisión fija
Costo variable    = p × Precio,    p = (comisión de cobro % + impuestos %) / 100
Costo total       = C + p × Precio
Ganancia estimada = Precio − Costo total
Margen %          = Ganancia / Precio × 100
Recargo %         = Ganancia / Costo total × 100
```

Precio sugerido según el objetivo configurado (las comisiones porcentuales se descuentan del precio, por eso aparecen en el denominador):

| Objetivo | Fórmula |
|---|---|
| Margen % (m) | `P = C / (1 − p − m)` |
| Ganancia fija (G) | `P = (C + G) / (1 − p)` |
| Recargo % (k) | `P = C·(1 + k) / (1 − p·(1 + k))` |

Si el denominador es 0 o negativo (por ejemplo, comisiones + margen ≥ 100 %), no hay precio posible y se informa el error en lugar de dividir.

Redondeo: `P' = redondear((P − terminación) / paso) × paso + terminación`, hacia arriba (recomendado), al más cercano o hacia abajo.
Ej.: paso $1.000 y terminación −$100 → precios terminados en 900.

**Ejemplo** (comisión 6 %, impuestos 3 %, margen 30 %): proveedor $45.000 + transporte $3.000 + embalaje $1.000 = $49.000 →
$49.000 / 0,61 = $80.327,87 → redondeado $81.000 → ganancia $24.710, margen 30,5 %, recargo 43,9 %.

## Datos faltantes

- Sin costo del proveedor no se calcula nada.
- Cualquier otro componente sin dato se toma como 0 **y se informa** ("cálculo parcial: sin dato para…").
- Sin objetivo configurado no hay precio sugerido. Sin margen mínimo, se advierte.

## Controles

- El costo no se edita a mano: cada cambio pasa por una propuesta (valor y fecha anterior vs. nuevo, impacto) que se aprueba o rechaza.
- Precio publicado bajo el margen mínimo o con pérdida: exige confirmación explícita al guardar o aprobar, y bloquea la publicación.
- Aplicar un costo de una consulta más antigua que la vigente exige confirmación.
- Los pedidos (etapa 3) guardarán su propio precio acordado y costo histórico: un cambio de catálogo no los modifica.

## Datos que hay que cargar en Configuración

| Dato | Ejemplo de pregunta |
|---|---|
| Transporte Rosario → LOBBY por par | ¿Cuánto cuesta el envío de un par o de un bulto? ¿Cuántos pares por bulto? |
| Embalaje por par | Caja/bolsa/etiqueta |
| Envío al cliente asumido por LOBBY | ¿Lo paga el cliente o lo absorbe LOBBY? |
| Comisión de cobro | Mercado Pago u otro: % y cargo fijo; 0 si es efectivo/transferencia |
| Impuestos sobre la venta | Según el régimen fiscal (por ejemplo, Ingresos Brutos) |
| Objetivo | Margen %, recargo % o ganancia fija por par |
| Margen mínimo | Por debajo, se pide confirmación |
| Redondeo | Múltiplos de $1.000, terminación en 900, etc. |
| Días para considerar un costo desactualizado | 7 por defecto; con ofertas de grupo quizá conviene menos |
