'use client'

import { TriangleAlert, CircleCheck } from 'lucide-react'

/**
 * Los mensajes de error y de éxito de la aplicación.
 *
 * Antes cada mensaje traía el icono dentro de la cadena de texto
 * ("⚠️ Error de conexión") y cada sitio que lo mostraba repetía el
 * estilo. Eso tenía dos problemas. Uno de forma: los emoji los dibuja
 * el sistema operativo, así que el mismo aviso se veía distinto en
 * Windows, en Android y en un iPhone, y en la tablet de la portería
 * podía salir en un estilo que nadie revisó. Y uno de fondo: el texto
 * del mensaje y su presentación estaban mezclados, así que cambiar el
 * icono obligaba a tocar los sitios donde se escribe el mensaje, no
 * donde se dibuja.
 *
 * Ahora el texto es solo texto y acá se decide cómo se ve.
 */
export default function Aviso({ tipo = 'error', children, style }) {
    const error = tipo !== 'ok'
    const Icono = error ? TriangleAlert : CircleCheck
    const color = error ? '#c62828' : '#2e7d32'
    const fondo = error ? '#fdecea' : '#e8f5e9'

    return (
        <div
            // role="alert" hace que el lector de pantalla lo anuncie en
            // cuanto aparece, que es la diferencia entre enterarse del
            // error y quedarse esperando.
            role="alert"
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 16px',
                borderRadius: 12,
                fontSize: 14,
                fontWeight: 700,
                background: fondo,
                color,
                border: `2px solid ${color}`,
                ...style,
            }}
        >
            {/* flexShrink evita que el icono se aplaste cuando el
                mensaje es largo y el ancho queda justo. */}
            <Icono size={18} strokeWidth={2.5} style={{ flexShrink: 0 }} aria-hidden="true" />
            <span>{children}</span>
        </div>
    )
}
