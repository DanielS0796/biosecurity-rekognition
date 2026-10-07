# Pruebas del Lambda de auditoría

Verifican la lógica de `lambda/auditoria.js` sin tocar AWS. `preparar.js`
sustituye DynamoDB y Sentry por dobles de `dobles/` y trae una copia fresca
del Lambda, igual que en `pruebas/liveness`.

```bash
cd pruebas/auditoria && node prueba.js
```

Los tres defectos que motivaron estas pruebas:

**El buscador no encontraba nada viejo.** El Lambda devolvía
`listaRegistros.slice(0, 50)` y el filtro de fechas corría después, en el
navegador, sobre ese recorte. Con más de 50 accesos recientes, cualquier
búsqueda de meses atrás salía vacía porque esos registros nunca llegaban.
Ahora las fechas van al servidor y el recorte arbitrario desapareció.

**Los turnos de tarde se partían en dos.** Los accesos se guardan en UTC y el
agrupamiento usaba la fecha del ISO. En Colombia (UTC-5) una jornada de 14:00
a 20:00 cruza la medianoche UTC, así que la entrada caía en un día y la
salida en el siguiente: dos registros, ambos incompletos, y uno de ellos
marcado "Sin salida" sin serlo. El agrupamiento usa ahora la fecha local.

**El Excel salía en una sola columna.** El CSV separaba con coma, pero Excel
en configuración regional de español espera punto y coma. El CSV del Lambda
ya usa punto y coma, y la exportación del frontend genera un .xlsx real.

El caso 1 de la prueba es justamente el turno que cruza medianoche, y el 3
reconstruye el escenario de los 50 registros para comprobar que un acceso de
marzo sigue siendo encontrable con 60 accesos más nuevos en la tabla.
