# Pruebas del Lambda de autenticación

Verifican la lógica de `lambda/reset.js` sin tocar AWS. `preparar.js` sustituye
DynamoDB, Sentry y nodemailer por dobles de `dobles/` y trae una copia fresca
del Lambda.

```bash
cd pruebas/reset && node prueba.js
```

Lo que había antes de este cambio, y que estas pruebas fijan para que no vuelva:

**Un administrador con la contraseña publicada.** `reset.js` traía escrito
`dfguatibonza` / `clave123` con acceso a RRHH y Auditoría, en un repositorio.
Ahora el acceso de emergencia sale de variables de entorno y se guarda hasheado.

**Contraseñas en texto plano.** Se guardaban tal cual en DynamoDB y el login
comparaba cadenas. Ahora se usa scrypt con comparación en tiempo constante. Los
registros anteriores migran solos: en el primer login se valida en plano por
última vez y se re-guarda hasheado, así nadie queda afuera.

**El rol nunca se respetó.** Se guardaba fijo al crear, `obtenerUsuario`
devolvía siempre `["rrhh","auditoria"]` y el `PutItem` del cambio de contraseña
borraba el campo. Las tres capas están corregidas, y el `UpdateItem` ya no
destruye el resto del registro.

**El código de recuperación no tenía tope.** Seis dígitos sin límite de
intentos se recorren enteros con un script. Ahora admite cinco y se destruye al
agotarlos.

**La contraseña viajaba por correo.** El mensaje de bienvenida la incluía en
texto plano. Ahora el servidor genera una temporal, la muestra una sola vez a
quien administra para que la entregue en persona, y obliga a cambiarla en el
primer ingreso.

**El login revelaba qué usuarios existen**, respondiendo distinto ante usuario
inexistente y contraseña incorrecta. Ahora el mensaje es el mismo, y pedir un
código de recuperación responde igual exista o no la cuenta.

**El servidor no sabía quién llamaba (R09).** Crear usuarios, cambiar roles,
eliminarlos y listarlos respondía a cualquiera que conociera la URL: la
interfaz escondía los botones, pero la Lambda no pedía sesión. Ahora el login
entrega un token firmado (`lambda/sesion.js`) y esas cuatro acciones lo
exigen. La sección 23 fija el comportamiento: sin token, 401; con token
alterado, firmado con otro secreto, con `alg: none` o vencido, 401; con sesión
pero sin el rol, 403; si a la persona le quitan el rol o la eliminan, su token
deja de servir en la siguiente petición. Quién hace el cambio sale del token,
no del cuerpo, que es lo que permitía saltarse "no te puedes quitar tu propio
permiso" escribiendo otro nombre.
