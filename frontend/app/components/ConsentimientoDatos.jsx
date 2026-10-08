'use client'

import { useState } from 'react'

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
    texto: 'Un vector matemático derivado de tu rostro, no la fotografía. ' +
      'Ese vector es un conjunto de números del que no se puede reconstruir tu cara.',
  },
  {
    titulo: 'Para qué',
    texto: 'Únicamente para verificar tu identidad al entrar a las instalaciones. ' +
      'No se usa para evaluar desempeño, medir permanencia ni ninguna otra finalidad.',
  },
  {
    titulo: 'Quién lo trata',
    texto: 'Fundación Universitaria Compensar, como responsable. El procesamiento ' +
      'técnico ocurre en Amazon Web Services, en servidores de Estados Unidos.',
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

  return (
    <div style={e.fondo}>
      <div style={e.tarjeta}>
        <div style={e.encabezado}>
          <div style={e.titulo}>Autorización de datos biométricos</div>
          <div style={e.ley}>Ley 1581 de 2012 · Decreto 1377 de 2013</div>
        </div>

        <div style={e.cuerpo}>
          <p style={e.intro}>
            {nombre ? <><strong>{nombre}</strong>, antes</> : 'Antes'} de escanear el rostro
            necesitamos tu permiso. Lee esto con calma; no hay prisa.
          </p>

          {PUNTOS.map((p, i) => (
            <div key={i} style={e.punto}>
              <div style={e.puntoTitulo}>{p.titulo}</div>
              <div style={e.puntoTexto}>{p.texto}</div>
            </div>
          ))}

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
        </div>

        <div style={e.pie}>
          <button
            onClick={onRechaza}
            style={e.botonRechazo}>
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
              opacity: marcada ? 1 : 0.4,
              cursor: marcada ? 'pointer' : 'not-allowed',
            }}>
            Autorizo y continúo
          </button>
        </div>

        <div style={e.version}>Versión {POLITICA_VERSION}</div>
      </div>
    </div>
  )
}

const e = {
  fondo: {
    position: 'fixed', inset: 0, zIndex: 9000,
    background: 'rgba(16,24,40,0.80)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 14, overflowY: 'auto',
  },
  tarjeta: {
    background: '#fff', borderRadius: 18,
    width: '100%', maxWidth: 520, maxHeight: '92vh',
    display: 'flex', flexDirection: 'column',
    fontFamily: 'Nunito, sans-serif',
    boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
    overflow: 'hidden',
  },
  encabezado: { padding: '20px 24px 14px', borderBottom: '1px solid #f0f0f0' },
  titulo: { fontSize: 18, fontWeight: 800, color: 'var(--blue)' },
  ley: { fontSize: 11.5, color: '#999', marginTop: 3 },
  cuerpo: { padding: '16px 24px', overflowY: 'auto', flex: 1 },
  intro: { fontSize: 13.5, color: '#444', lineHeight: 1.6, margin: '0 0 16px' },
  punto: { marginBottom: 13 },
  puntoTitulo: { fontSize: 12.5, fontWeight: 800, color: '#1A2D5A', marginBottom: 3 },
  puntoTexto: { fontSize: 12.5, color: '#555', lineHeight: 1.55 },
  casillaFila: {
    display: 'flex', gap: 10, alignItems: 'flex-start',
    marginTop: 18, padding: 13,
    background: '#f6f8fc', borderRadius: 12, cursor: 'pointer',
  },
  casilla: { width: 19, height: 19, marginTop: 1, flexShrink: 0, cursor: 'pointer' },
  casillaTexto: { fontSize: 12.5, color: '#333', lineHeight: 1.55 },
  pie: {
    display: 'flex', gap: 10, padding: '14px 24px',
    borderTop: '1px solid #f0f0f0', background: '#fafafa',
  },
  botonRechazo: {
    flex: 1, padding: 13, borderRadius: 12,
    border: '2px solid #ddd', background: 'transparent', color: '#666',
    fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
  },
  botonAutoriza: {
    flex: 2, padding: 13, borderRadius: 12, border: 'none',
    background: 'var(--orange)', color: '#fff',
    fontFamily: 'inherit', fontSize: 13.5, fontWeight: 800,
  },
  version: {
    textAlign: 'center', fontSize: 10.5, color: '#bbb',
    padding: '0 0 12px', background: '#fafafa',
  },
}
