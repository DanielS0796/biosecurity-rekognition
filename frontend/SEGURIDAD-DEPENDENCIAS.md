# Avisos de seguridad en las dependencias

`npm audit` reporta siete avisos en este proyecto. Ninguno es crítico y
ninguno tiene arreglo disponible hoy. Este archivo explica cuáles son,
por qué siguen ahí y qué habría que hacer el día que aparezca un
parche, para que nadie tenga que reconstruir el razonamiento desde
cero.

Última revisión: 8 de octubre de 2026, sobre Next.js 16.4.0.

## Lo que sí se arregló

Next.js estaba en 16.2.4, afectado por
[GHSA-8h8q-6873-q5fj](https://github.com/advisories/GHSA-8h8q-6873-q5fj),
una denegación de servicio con Server Components clasificada como
**crítica**. Se subió a 16.4.0, que la corrige y de paso resuelve dos
avisos altos que venían dentro de Next: `postcss`
([GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93),
XSS en la salida del stringify de CSS) y `sharp`
([GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj),
vulnerabilidades heredadas de libvips).

El salto es menor dentro de la misma versión mayor y el build pasa sin
cambios en el código.

## Lo que queda, y por qué

### La cadena del linter: braces, micromatch, fast-glob, eslint-config-next, @next/eslint-plugin-next

Cinco avisos, un solo problema de fondo:
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
agotamiento de pila en `braces` con patrones muy anidados. Los otros
cuatro son la misma falla asomando a través de quien lo usa:

    eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces

No se arregla por tres razones, en este orden:

1. El aviso marca **todas** las versiones de `braces` como vulnerables.
   No hay versión parcheada a la que subir, ni sirve un `override`.
2. Lo que `npm audit fix` propone es bajar `eslint-config-next` a
   14.2.35, tres versiones mayores por debajo de la que necesita este
   proyecto. Rompería el linter y probablemente el build.
3. Es una dependencia de desarrollo. `braces` corre cuando alguien
   ejecuta el linter en su máquina, no en el navegador de nadie. Para
   explotarla haría falta que un atacante controlara los patrones de
   glob del linter, lo que implica que ya tiene acceso al repositorio.

El día que salga una `braces` parcheada, un `npm update` dentro de
`frontend/` cierra los cinco de una vez.

### exceljs y uuid

`exceljs` 4.4.0 es la última publicada y arrastra una `uuid` afectada
por
[GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq):
falta una comprobación de límites del búfer en las versiones 3, 5 y 6
del generador, **cuando se le pasa un búfer propio**. `exceljs` no lo
hace: lo llama en su forma simple, que devuelve una cadena.

El arreglo que propone npm es bajar `exceljs` a 3.4.0, lo que rompería
la exportación a Excel del módulo de auditoría. Entre una moderada que
no se alcanza por el camino que usamos y perder una función que sí se
usa, se queda como está.

## Cómo revisarlo de nuevo

```bash
cd frontend
npm audit
```

Si aparece algo **crítico o alto que no esté en esta lista**, hay que
mirarlo: significa que entró con una dependencia nueva o que se publicó
un aviso sobre algo que ya estaba. Los siete de acá son conocidos y
están aceptados a conciencia, no por inercia.
