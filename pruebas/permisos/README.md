# Permisos de IAM frente al código

Comprobación estática: para cada Lambda que toca DynamoDB, mira qué
comandos del SDK instancia y verifica que su política de Terraform
conceda la acción correspondiente.

    node pruebas/permisos/prueba.js

Sale con código 1 si falta algún permiso, así que sirve en un hook o en
CI.

## Por qué existe

`guardarClave()` pasó de `PutItem` a `UpdateItem` para no reemplazar el
registro entero del usuario y perderle el rol. La política de IAM se
quedó con `PutItem`. Las 45 pruebas de `pruebas/reset/` siguieron en
verde, porque el doble de DynamoDB responde sin mirar permisos, y el
error apareció en producción como un "Error interno" en la pantalla de
cambio de contraseña obligatorio — sin pista de que fuera IAM.

Un doble no puede detectar esto: por definición no es AWS. Lo que sí se
puede comparar es el código contra la política, y eso es lo que hace
este archivo.

## Mantenimiento

`COBERTURA`, en el encabezado del script, dice qué política cubre a qué
Lambda. Un Lambda nuevo que use DynamoDB y no esté en esa lista se
reporta como hueco, así que la lista no se desactualiza en silencio.

Compara acciones, no ARNs: una política que conceda `UpdateItem` sobre
la tabla equivocada pasaría en verde.
