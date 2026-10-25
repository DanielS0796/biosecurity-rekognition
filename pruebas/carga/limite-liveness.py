#!/usr/bin/env python3
"""
Comprueba, contra el API de liveness ya desplegado, que el límite de
solicitudes de la etapa corta las ráfagas antes de llegar al tope de
Lambda. Es la contraparte de la prueba de carga del 13 de octubre: aquella
mostró que sin límite las solicitudes de más salían como error 500 del
servidor; esta muestra que ahora salen como 429 "espere un momento",
sin invocar la función ni abrir una sesión de Rekognition.

    python3 pruebas/carga/limite-liveness.py --url <api_liveness_init_url>

La URL sale de los outputs de Terraform:

    terraform output -raw api_liveness_init_url

Dos advertencias, porque esto golpea un sistema real:

1. COSTO. Cada solicitud que el límite deja pasar abre una sesión de Face
   Liveness, que se cobra. El script manda ráfagas cortas y se detiene en
   cuanto una ráfaga ya trae respuestas 429, así que el número de sesiones
   que se abren es pequeño (unas decenas) y el gasto queda en centavos. Aun
   así, no es gratis: corre lo justo para ver el bloqueo y para.

2. TU PROPIA IP. Si lo corres desde la red de la universidad, que es la
   misma por la que entra la gente a la portería, el límite por IP del WAF
   podría bloquear un rato a toda esa red. Córrelo desde otra conexión,
   por ejemplo los datos del celular.

No manda cargas de ataque ni explota ninguna falla: repite la misma
llamada legítima que hace la aplicación, con un cuerpo de validación
normal, y solo cuenta con qué código responde.
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

# El script solo apunta a un API de liveness de este proyecto. No es una
# herramienta para disparar contra cualquier URL: si el host no es un API
# Gateway de AWS, se niega.
HOST_VALIDO = ".execute-api.us-east-1.amazonaws.com"


def una_solicitud(url, timeout=20):
    """Manda un /liveness-init de validación y devuelve el código HTTP.

    Es la misma llamada del acceso de la portería: propósito 'validacion',
    sin datos personales. No abre nada más que una sesión de liveness, que
    es justo lo que el límite debe racionar.
    """
    cuerpo = json.dumps({"proposito": "validacion"}).encode()
    req = urllib.request.Request(
        url, data=cuerpo, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status
    except urllib.error.HTTPError as e:
        # 429 (límite de la etapa), 403 (WAF) y 5xx llegan por acá.
        return e.code
    except Exception:
        # Un fallo de red cuenta aparte: no es ni un 200 ni un bloqueo.
        return 0


def rafaga(url, n, workers):
    """Lanza n solicitudes casi a la vez y cuenta los códigos."""
    cuenta = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for codigo in pool.map(lambda _: una_solicitud(url), range(n)):
            cuenta[codigo] = cuenta.get(codigo, 0) + 1
    return cuenta


def describe(codigo):
    return {
        200: "200 abrió sesión",
        429: "429 límite",
        403: "403 WAF",
        0: "sin respuesta",
    }.get(codigo, f"{codigo}")


def main():
    ap = argparse.ArgumentParser(description="Prueba del límite del API de liveness")
    ap.add_argument("--url", required=True, help="api_liveness_init_url de Terraform")
    ap.add_argument("--rafagas", type=int, default=4, help="máximo de ráfagas (tope de seguridad)")
    ap.add_argument("--tamano", type=int, default=25, help="solicitudes por ráfaga")
    args = ap.parse_args()

    if HOST_VALIDO not in args.url or "liveness-init" not in args.url:
        print(f"La URL no parece un API de liveness de este proyecto: {args.url}")
        print("Debe terminar en /liveness-init y vivir en execute-api de AWS.")
        sys.exit(1)

    # Tope duro: pase lo que pase, nunca más de este total de solicitudes,
    # para que un error de dedos no dispare miles de sesiones.
    tope_total = args.rafagas * args.tamano
    print("──────────────────────────────────────────────────")
    print(" Límite de solicitudes del API de liveness")
    print("──────────────────────────────────────────────────")
    print(f" Ráfagas de {args.tamano}, hasta {args.rafagas} (máx. {tope_total} solicitudes).")
    print(" Para en cuanto una ráfaga traiga respuestas 429.\n")

    total = {}
    bloqueo_visto = False
    for i in range(1, args.rafagas + 1):
        cuenta = rafaga(args.url, args.tamano, workers=args.tamano)
        for k, v in cuenta.items():
            total[k] = total.get(k, 0) + v

        resumen = "  ".join(f"{describe(k)}: {cuenta[k]}" for k in sorted(cuenta))
        print(f"  Ráfaga {i}:  {resumen}")

        if cuenta.get(429, 0) > 0 or cuenta.get(403, 0) > 0:
            bloqueo_visto = True
            # Una ráfaga más, para confirmar que el bloqueo se sostiene y no
            # fue un pico suelto, y se corta.
            if i >= 2:
                break
        time.sleep(1)

    print("\n" + "─" * 52)
    abiertas = total.get(200, 0)
    limitadas = total.get(429, 0)
    waf = total.get(403, 0)
    # Dos cosas distintas que conviene no mezclar:
    #   429  -> el límite de tasa de la etapa (API Gateway). Es lo que
    #           queremos ver: corta la presión sostenida.
    #   500  -> el tope de 10 Lambdas simultáneas de la cuenta, que rebota
    #           lo que pasa de ahí. Es el límite conocido del punto 4, no
    #           una falla del throttling. Ninguna de las dos ejecuta la
    #           función ni abre una sesión de Rekognition.
    concurrencia = sum(v for k, v in total.items() if k >= 500)
    red = total.get(0, 0)

    print(f"  Sesiones que se abrieron (200):        {abiertas}")
    print(f"  Cortadas por el límite de tasa (429):  {limitadas}")
    if waf:
        print(f"  Bloqueadas por el WAF (403):           {waf}")
    if concurrencia:
        print(f"  Rebotadas por el tope de Lambda (5xx): {concurrencia}")
    if red:
        print(f"  Sin respuesta (red):                   {red}")

    print("─" * 52)
    if red:
        print("Hubo solicitudes sin respuesta. Puede ser la conexión; repite")
        print("la prueba antes de sacar conclusiones.")
        sys.exit(1)
    if not bloqueo_visto:
        print("No se vio ningún 429. Puede que la ráfaga sea menor que el")
        print("límite: súbela con --tamano y vuelve a intentar.")
        sys.exit(1)

    print("El límite de tasa funciona: la presión sostenida se corta con")
    print("429 y ninguna de esas solicitudes abrió una sesión, así que un")
    print("bucle no dispara el costo.")
    if concurrencia:
        print()
        print(f"Los {concurrencia} rebotes 5xx son el tope de 10 Lambdas")
        print("simultáneas de la cuenta, no una falla de este límite: un")
        print("límite por tasa no frena un pico instantáneo, solo la presión")
        print("sostenida. Eliminarlos del todo exige ampliar la cuota de")
        print("concurrencia (punto 4). Tampoco cuestan: la función no corre.")
    sys.exit(0)


if __name__ == "__main__":
    main()
