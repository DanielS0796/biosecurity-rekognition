'use client'

/**
 * El fondo de la aplicación: un mosaico de nueve paños con los colores
 * de la institución, atenuado por una capa de color y rematado con una
 * viñeta.
 *
 * Estaba escrito tres veces, una por pantalla, lo que garantizaba que
 * tarde o temprano dejaran de parecerse. Ahora vive acá.
 *
 * Lo que cambió al unificarlo: antes había dos círculos de color
 * —naranja arriba a la izquierda, cian abajo a la derecha— flotando
 * sobre el mosaico. Esos manchones difusos son el recurso más repetido
 * de las interfaces generadas de los últimos años, y en una aplicación
 * institucional no dicen nada. En su lugar va una viñeta radial, que da
 * la misma profundidad sin el aire de plantilla: oscurece los bordes y
 * deja el centro limpio, que es donde está el contenido.
 */

// Los nueve paños. Mezclan los dos colores de la marca con sus vecinos
// para que el mosaico tenga variedad sin salirse de la paleta.
const PANOS = [
    '#F05A22,#FF8C42',
    '#4B2D8F,#6B4CC0',
    '#00B4D8,#0077A8',
    '#1A2D5A,#2D4A8A',
    '#F05A22,#4B2D8F',
    '#00B4D8,#4B2D8F',
    '#4B2D8F,#00B4D8',
    '#1A2D5A,#F05A22',
    '#F05A22,#1A2D5A',
]

export default function Fondo() {
    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 0 }} aria-hidden="true">
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gridTemplateRows: 'repeat(3, 1fr)',
                height: '100%',
            }}>
                {PANOS.map((g, i) => (
                    <div key={i} style={{
                        background: `linear-gradient(135deg, ${g})`,
                        filter: 'saturate(0.6) brightness(0.7)',
                    }} />
                ))}
            </div>

            {/* La capa que baja el contraste del mosaico para que el
                contenido se lea encima sin pelear con él. */}
            <div style={{
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(160deg, rgba(75,45,143,0.75) 0%, rgba(26,45,90,0.85) 50%, rgba(75,45,143,0.75) 100%)',
            }} />

            {/* La viñeta. Reemplaza a los dos círculos de color. */}
            <div style={{
                position: 'absolute',
                inset: 0,
                background: 'radial-gradient(ellipse at 50% 38%, rgba(0,0,0,0) 35%, rgba(10,18,40,0.45) 100%)',
            }} />
        </div>
    )
}
