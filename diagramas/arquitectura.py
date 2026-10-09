#!/usr/bin/env python3
"""
Dibuja la arquitectura de Biosecurity UCompensar tal como está hoy.

Se genera desde el código, no a mano, por una razón concreta: el
diagrama que teníamos mostraba el frontend en S3 con CloudFront y un
endpoint de "validación pública" que ya no existen, y no mostraba
liveness por ningún lado. Un diagrama que se dibuja a mano envejece sin
avisar; este se vuelve a correr y se nota.

    python3 diagramas/arquitectura.py

Deja diagramas/arquitectura.png. Necesita graphviz y la librería
diagrams:

    sudo apt install graphviz
    pip install diagrams
"""

from diagrams import Diagram, Cluster, Edge
from diagrams.aws.compute import Lambda
from diagrams.aws.database import Dynamodb
from diagrams.aws.ml import Rekognition
from diagrams.aws.mobile import Amplify
from diagrams.aws.network import APIGateway
from diagrams.aws.security import KMS, Cognito, WAF
from diagrams.aws.storage import S3
from diagrams.onprem.client import User, Users

SALIDA = "diagramas/arquitectura"

# splines ortogonales se ven ordenados con pocas aristas y se vuelven
# un nudo con muchas; acá hay suficientes cruces para que convenga la
# curva. concentrate junta las paralelas que van al mismo sitio.
GRAFO = {
    "fontsize": "28",
    "bgcolor": "white",
    "pad": "0.6",
    "splines": "spline",
    "concentrate": "true",
    "nodesep": "0.5",
    "ranksep": "1.3",
}

# Gris para lo que es tránsito y color solo donde hay que mirar.
NORMAL = Edge(color="#5a6a7a")
SENSIBLE = Edge(color="#c2410c", style="bold")
PENDIENTE = Edge(color="#94a3b8", style="dashed")

with Diagram(
    "Biosecurity UCompensar — 8 de octubre de 2026",
    filename=SALIDA,
    outformat="png",
    show=False,
    direction="TB",
    graph_attr=GRAFO,
):
    persona = User("Persona en portería")
    equipo = Users("RRHH · Auditoría")

    with Cluster("Navegador"):
        frontend = Amplify("Amplify\nPWA en Next.js")
        identity = Cognito("Identity Pool\ncredenciales\ntemporales")

    with Cluster("Protección (escrita, sin aplicar)"):
        waf = WAF("WAF\nbiosecurity-apis")

    with Cluster("API Gateway"):
        api_liveness = APIGateway("Liveness\nh1jhziuxw4\nsin llave")
        api_rrhh = APIGateway("RRHH\njfshekzwbl\nAPI key")
        api_auditoria = APIGateway("Auditoría\nsdvymkutn7\nAPI key")
        api_reset = APIGateway("Autenticación\nqwnsrgtar9\nsin llave")

    with Cluster("Lambdas"):
        l_liveness = Lambda("liveness-detection")
        l_rrhh = Lambda("registrar-empleado")
        l_auditoria = Lambda("auditoria")
        l_reset = Lambda("reset")

    with Cluster("Biometría"):
        rekognition = Rekognition("Face Liveness\n+ colección\ncoleccion2anlusoft")
        evidencias = S3("Evidencias\n7 días")
        kms = KMS("KMS\nbiosecurity-key")

    with Cluster("DynamoDB"):
        t_empleados = Dynamodb("empleados")
        t_retirados = Dynamodb("retirados")
        t_accesos = Dynamodb("accesos")
        t_sesiones = Dynamodb("liveness-sessions")
        t_usuarios = Dynamodb("usuarios")
        t_codigos = Dynamodb("reset-codes")

    # ── Quién entra por dónde ──────────────────────────────────────
    persona >> NORMAL >> frontend
    equipo >> NORMAL >> frontend

    frontend >> NORMAL >> api_liveness
    frontend >> NORMAL >> api_rrhh
    frontend >> NORMAL >> api_auditoria
    frontend >> NORMAL >> api_reset

    # El WAF todavía no está asociado a ninguna etapa.
    waf >> PENDIENTE >> api_rrhh
    waf >> PENDIENTE >> api_auditoria
    waf >> PENDIENTE >> api_reset

    # El vídeo del escaneo no pasa por el backend: va del navegador a
    # Rekognition con credenciales temporales del Identity Pool. Es la
    # pieza que hace que una fotografía no sirva.
    frontend >> SENSIBLE >> identity
    frontend >> SENSIBLE >> rekognition

    api_liveness >> NORMAL >> l_liveness
    api_rrhh >> NORMAL >> l_rrhh
    api_auditoria >> NORMAL >> l_auditoria
    api_reset >> NORMAL >> l_reset

    # ── Qué toca cada Lambda ───────────────────────────────────────
    l_liveness >> SENSIBLE >> rekognition
    l_liveness >> SENSIBLE >> evidencias
    l_liveness >> NORMAL >> t_sesiones
    l_liveness >> NORMAL >> t_accesos
    l_liveness >> NORMAL >> t_empleados

    l_rrhh >> SENSIBLE >> rekognition
    l_rrhh >> NORMAL >> t_empleados
    l_rrhh >> NORMAL >> t_retirados

    # Auditoría lee las tres para poder poner nombre y vínculo a cada
    # cédula del reporte, incluida la de quien ya se retiró.
    l_auditoria >> NORMAL >> t_accesos
    l_auditoria >> NORMAL >> t_empleados
    l_auditoria >> NORMAL >> t_retirados

    l_reset >> NORMAL >> t_usuarios
    l_reset >> NORMAL >> t_codigos

    evidencias >> NORMAL >> kms
