# Pruebas del Lambda de liveness

Verifican la lógica de `lambda/liveness.js` sin tocar AWS.

`preparar.js` corre al arrancar y hace dos cosas. Copia los dobles de
Rekognition y DynamoDB desde `dobles/` hacia `node_modules/`, que es donde
`require()` los busca — `node_modules` no se versiona, así que esto mantiene
las pruebas reproducibles después de un clon. Y trae una copia fresca del
Lambda, porque Node resuelve los `require()` desde la ubicación del archivo
que los hace y el Lambda solo ve los dobles si se ejecuta desde esta
carpeta. Al copiarlo en cada corrida, las pruebas no pueden pasar contra
código viejo.

```bash
cd pruebas/liveness && node prueba.js
```

Lo que se comprueba, en orden:

1. Un intento con foto queda rechazado — Rekognition reporta `FAILED` y el
   Lambda no llega a buscar el rostro.
2. Un liveness con confianza bajo el umbral se rechaza sin indexar ni buscar.
3. **El endpoint de resultado ignora cualquier imagen que venga en el cuerpo
   de la petición** y usa la `ReferenceImage` que produjo Rekognition. Es la
   prueba que sostiene todo lo demás: sin esto, alguien podría pasar el
   escaneo con su cara y enviar la foto de otra persona.
4. Una sesión ya consumida devuelve 409 (anti-replay).
5. Un `session_id` inexistente se rechaza.
6. El registro indexa la imagen de AWS con la cédula como `ExternalImageId`.
7. Una cédula ya registrada falla antes de hacer pasar a nadie por el escaneo.
8. El registro exige identificación y nombre.
9. Una persona real pero no registrada queda negada y con rastro en auditoría.
10. Cada propósito pide su desafío: la entrada sin destellos, el registro con
    destellos.
11. Si el SDK del runtime no aceptara `ChallengePreferences`, la sesión se
    crea igual con el desafío predeterminado.
12. Un error que no es de validación (throttling, por ejemplo) se propaga en
    lugar de reintentarse.
13. La vía para personas fotosensibles omite los destellos también en el
    registro, y sin esa bandera el registro los mantiene.
