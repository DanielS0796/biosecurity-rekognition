'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Autorización para el tratamiento de datos biométricos.
 *
 * Los datos biométricos son sensibles según el artículo 5 de la Ley 1581
 * de 2012, así que su tratamiento exige autorización previa, expresa e
 * informada. Las tres palabras mandan sobre el diseño de esta pantalla:
 *
 *   previa     va antes de encender la cámara, no después de capturar
 *   expresa    una casilla que se marca a propósito, nunca premarcada
 *   informada  el texto completo a la vista, no detrás de un enlace
 *
 * Por eso el botón de autorizar nace deshabilitado y el de rechazar no:
 * negarse tiene que ser al menos tan fácil como aceptar, o el
 * consentimiento no es libre.
 *
 * Ocupa la pantalla entera a propósito. Una autorización que se lee en
 * una ventanita de 12 píxeles se firma sin leer, y una autorización que
 * nadie leyó es mala prueba el día que alguien reclame.
 *
 * La versión viaja al servidor y queda guardada con la autorización. Si
 * se cambia el texto de abajo hay que subir POLITICA_VERSION acá y en
 * liveness-api.tf, o las constancias dirán que la gente aceptó algo que
 * ya no existe.
 */

export const POLITICA_VERSION = '2026-10-v1'
export const CANAL_HABEAS_DATA = 'biosecurityucompensar@gmail.com'

const PUNTOS = [
  {
    titulo: 'Qué se guarda',
    texto: 'Un vector matemático derivado de tu rostro, no la fotografía. Ese vector ' +
      'es un conjunto de números del que no se puede reconstruir tu cara.',
  },
  {
    titulo: 'Para qué',
    texto: 'Únicamente para verificar tu identidad al entrar a las instalaciones. ' +
      'No se usa para evaluar desempeño, medir permanencia ni ninguna otra finalidad.',
  },
  {
    titulo: 'Quién lo trata',
    texto: 'Fundación Universitaria Compensar, como responsable del tratamiento. ' +
      'El procesamiento técnico ocurre en Amazon Web Services, en servidores ' +
      'ubicados en Estados Unidos.',
  },
  {
    titulo: 'Por cuánto tiempo',
    texto: 'Mientras mantengas tu vínculo con la institución. Al terminar, el registro ' +
      'pasa a retirados y el vector se elimina de la colección biométrica.',
  },
  {
    titulo: 'Tus derechos',
    texto: 'Puedes conocer, actualizar, rectificar y revocar esta autorización cuando ' +
      `quieras, sin dar explicaciones, escribiendo a ${CANAL_HABEAS_DATA}. ` +
      'Si revocas, se elimina el dato biométrico y tu ingreso se gestiona por otro medio.',
  },
  {
    titulo: 'Si prefieres no autorizar',
    // Antes esto prometía el ingreso con documento en portería. Lo
    // quitamos: la app no controla la entrada física y no puede
    // garantizar algo que depende de otra área. Queda lo que sí es
    // cierto y lo que la persona necesita saber para decidir.
    texto: 'No estás obligado. Si no autorizas, no se registra tu rostro ni se guarda ' +
      'ningún dato biométrico tuyo, y tu ingreso se gestiona por otro medio.',
  },
]

export default function ConsentimientoDatos({ nombre, onAutoriza, onRechaza }) {
  const [marcada, setMarcada] = useState(false)
  const [montado, setMontado] = useState(false)

  // Se dibuja desde un portal sobre document.body. La tarjeta que la
  // contiene tiene backdrop-filter, y eso convierte a ese elemento en el
  // marco de referencia de los position:fixed que lleva dentro: sin el
  // portal, esta pantalla queda encerrada en la tarjeta y aplastada.
  useEffect(() => { setMontado(true) }, [])
  if (!montado) return null

  const pantalla = (
    <div style={e.fondo}>
      <div style={e.hoja}>
        <div style={e.columna}>

          <header style={e.encabezado}>
            <h1 style={e.titulo}>Autorización de datos biométricos</h1>
            <p style={e.entrada}>
              {nombre ? <><strong style={e.nombre}>{nombre}</strong>, antes</> : 'Antes'} de
              escanear tu rostro necesitamos tu permiso. Lee esto con calma; no hay prisa
              y puedes decir que no.
            </p>
          </header>

          <div style={e.puntos}>
            {PUNTOS.map((p, i) => (
              <section key={i} style={e.punto}>
                <h2 style={e.puntoTitulo}>{p.titulo}</h2>
                <p style={e.puntoTexto}>{p.texto}</p>
              </section>
            ))}
          </div>

          <div style={e.marco}>
            <p style={e.marcoTexto}>
              Esta autorización se otorga conforme a la <strong>Ley Estatutaria 1581
              de 2012</strong>, por la cual se dictan disposiciones generales para la
              protección de datos personales en Colombia, y a su decreto
              reglamentario, el <strong>Decreto 1377 de 2013</strong>.
            </p>
            <p style={e.marcoTexto}>
              El artículo 5 clasifica los datos biométricos como datos sensibles. El
              artículo 9 exige que su tratamiento cuente con autorización previa e
              informada del titular. El artículo 8 reconoce tu derecho a conocer,
              actualizar, rectificar y revocar lo que autorices, en cualquier momento.
            </p>
          </div>

          <label style={e.casillaFila}>
            <input
              type="checkbox"
              checked={marcada}
              onChange={ev => setMarcada(ev.target.checked)}
              style={e.casilla}
            />
            <span style={e.casillaTexto}>
              Leí la información anterior y <strong>autorizo</strong> de forma libre,
              previa, expresa e informada el tratamiento de mis datos biométricos
              para el control de acceso.
            </span>
          </label>

          <p style={e.version}>Política versión {POLITICA_VERSION}</p>
        </div>
      </div>

      <div style={e.pie}>
        <div style={e.pieColumna}>
          <button onClick={onRechaza} style={e.botonRechazo}>
            No autorizo
          </button>
          <button
            onClick={() => onAutoriza({
              autorizado: true,
              politica_version: POLITICA_VERSION,
              canal: 'app-web',
            })}
            disabled={!marcada}
            style={{
              ...e.botonAutoriza,
              background: marcada ? 'var(--orange)' : '#d9d9d9',
              color: marcada ? '#fff' : '#8a8a8a',
              cursor: marcada ? 'pointer' : 'not-allowed',
            }}>
            Autorizo y continúo
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(pantalla, document.body)
}

const e = {
  fondo: {
    position: 'fixed', inset: 0, zIndex: 9000,
    background: '#f4f6fa',
    display: 'flex', flexDirection: 'column',
    fontFamily: 'Nunito, sans-serif',
  },
  hoja: { flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' },
  columna: {
    maxWidth: 640, margin: '0 auto',
    padding: '40px 20px 32px',
  },

  encabezado: { marginBottom: 32 },
  titulo: {
    fontSize: 28, lineHeight: 1.2, fontWeight: 800,
    color: 'var(--blue)', margin: '0 0 14px',
    letterSpacing: '-0.015em',
  },
  entrada: {
    fontSize: 16, lineHeight: 1.65, color: '#4a5260', margin: 0,
  },
  nombre: { color: 'var(--blue)' },

  puntos: { display: 'flex', flexDirection: 'column', gap: 24 },
  punto: {},
  puntoTitulo: {
    fontSize: 16, fontWeight: 800, color: 'var(--blue)',
    margin: '0 0 6px',
  },
  puntoTexto: {
    fontSize: 15.5, lineHeight: 1.7, color: '#3f4650', margin: 0,
  },

  marco: {
    marginTop: 32, padding: '22px 24px',
    background: '#fff', borderRadius: 14,
    borderLeft: '4px solid var(--blue)',
  },
  marcoTexto: {
    fontSize: 14, lineHeight: 1.7, color: '#4a5260',
    margin: '0 0 12px',
  },

  casillaFila: {
    display: 'flex', gap: 14, alignItems: 'flex-start',
    marginTop: 28, padding: '20px 22px',
    background: '#fff', borderRadius: 14,
    border: '2px solid var(--blue)', cursor: 'pointer',
  },
  casilla: {
    width: 22, height: 22, marginTop: 2,
    flexShrink: 0, cursor: 'pointer', accentColor: '#1A2D5A',
  },
  casillaTexto: { fontSize: 15.5, lineHeight: 1.65, color: '#2b313a' },

  version: {
    fontSize: 12.5, color: '#9aa1ac',
    margin: '20px 0 0', textAlign: 'center',
  },

  pie: {
    borderTop: '1px solid #e2e6ed', background: '#fff',
    padding: '14px 20px',
    paddingBottom: 'calc(14px + env(safe-area-inset-bottom, 0px))',
  },
  pieColumna: {
    maxWidth: 640, margin: '0 auto',
    display: 'flex', gap: 12,
  },
  botonRechazo: {
    flex: 1, padding: '15px 12px', borderRadius: 12,
    border: '2px solid #ccd2dc', background: 'transparent', color: '#5a616b',
    fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer',
  },
  botonAutoriza: {
    flex: 2, padding: '15px 12px', borderRadius: 12, border: 'none',
    fontFamily: 'inherit', fontSize: 15, fontWeight: 800,
  },
}
