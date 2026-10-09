#!/usr/bin/env python3
"""
Limpia la salida de `terraform graph` para que se pueda leer.

El grafo crudo trae, además de los recursos, los nodos internos con que
Terraform organiza el trabajo: el proveedor, la raíz, los cierres de
provisión, las variables y las salidas. En un proyecto de este tamaño
esos nodos son más de la mitad de las cajas y todos los recursos
cuelgan del mismo nodo de proveedor, así que el dibujo queda dominado
por una estrella que no dice nada.

Acá se quitan esos nodos y se recorta el prefijo "[root] " de los
nombres. Lo que queda es qué recurso depende de qué recurso, que es la
pregunta que uno le hace a este diagrama.

    terraform graph | python3 diagramas/limpiar-grafo.py | dot -Tpng -o salida.png
"""

import re
import sys

# Nodos que Terraform necesita y el lector no.
RUIDO = re.compile(
    r"provider\[|"
    r"meta\.count-boundary|"
    r"root\"|"
    r"\[root\] root|"
    r"provisioner|"
    r"\bvar\.|"
    r"\boutput\."
)


def nombre(linea):
    """Devuelve el contenido de las comillas de una línea de nodo o arista."""
    return re.findall(r'"([^"]*)"', linea)


def main():
    salida = []
    for linea in sys.stdin:
        cruda = linea.rstrip("\n")

        etiquetas = nombre(cruda)
        if etiquetas and any(RUIDO.search(e) for e in etiquetas):
            continue

        # El prefijo "[root] " está en todos los nombres y no aporta.
        # El sufijo " (expand)" tampoco: es cómo Terraform marca los
        # recursos con for_each o count.
        limpia = cruda.replace("[root] ", "").replace(" (expand)", "")
        salida.append(limpia)

    texto = "\n".join(salida)

    # Un poco de estilo para que se lea de izquierda a derecha, que es
    # como se leen las dependencias: lo de la derecha necesita lo de la
    # izquierda.
    estilo = (
        '\trankdir="LR";\n'
        '\tbgcolor="white";\n'
        '\tnode [shape=box, style=rounded, fontname="Helvetica", '
        'fontsize=11, margin="0.15,0.08"];\n'
        '\tedge [color="#5a6a7a", arrowsize=0.7];\n'
    )
    texto = re.sub(r"(digraph[^\{]*\{\n)", r"\1" + estilo, texto, count=1)

    print(texto)


if __name__ == "__main__":
    main()
