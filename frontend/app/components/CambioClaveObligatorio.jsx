'use client'

import { useMemo, useState } from 'react'
import { API_RESET } from '../config'
import { Check, Dot } from 'lucide-react'

/**
 * Pantalla que intercepta el primer ingreso y obliga a cambiar la contraseña
 * temporal antes de dejar entrar al sistema.
 *
 * Los requisitos se muestran en vivo, pero quien decide es el servidor: la
 * misma política está implementada en el Lambda, porque la validación del
 * formulario se evita llamando al endpoint directamente.
 *
 * Props:
 *   usuario       nombre de usuario que acaba de autenticarse
 *   claveActual   la temporal con la que entró, para probar el cambio
 *   onListo       se llama con los roles del usuario cuando la contraseña
 *                 quedó cambiada, para entrar sin repetir el login
 *   onCancelar    vuelve al login sin entrar
 */

const REGLAS = [
  { texto: 'Al menos 10 caracteres', prueba: (c) => c.length >= 10 },
  { texto: 'Una letra mayúscula', prueba: (c) => /[A-ZÁÉÍÓÚÑ]/.test(c) },
  { texto: 'Una letra minúscula', prueba: (c) => /[a-záéíóúñ]/.test(c) },
  { texto: 'Un número', prueba: (c) => /[0-9]/.test(c) },
  { texto: 'Un símbolo', prueba: (c) => /[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ]/.test(c) },
]

export default function CambioClaveObligatorio({ usuario, claveActual, onListo, onCancelar }) {
  const [nueva, setNueva] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  const estado = useMemo(() => {
    const cumplidas = REGLAS.map(r => ({ ...r, ok: r.prueba(nueva) }))
    const contieneUsuario = !!nueva && !!usuario &&
      nueva.toLowerCase().includes(usuario.toLowerCase())
    const coinciden = nueva.length > 0 && nueva === confirmar
    const distinta = nueva !== claveActual
    return {
      cumplidas,
      contieneUsuario,
      coinciden,
      distinta,
      valida: cumplidas.every(r => r.ok) && !contieneUsuario && coinciden && distinta,
    }
  }, [nueva, confirmar, usuario, claveActual])

  async function guardar() {
    if (!estado.valida) return
    setGuardando(true)
    setError('')
    try {
      const r = await fetch(API_RESET, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accion: 'cambiar_clave',
          email: usuario,
          clave_actual: claveActual,
          nueva_clave: nueva,
        }),
      })
      const data = await r.json()
      const body = typeof data.body === 'string' ? JSON.parse(data.body) : data

      if (body.codigo === 0) onListo?.(body.rol || [])
      else setError(body.descripcion || 'No se pudo cambiar la contraseña')
    } catch (err) {
      setError('Error de conexión: ' + err.message)
    }
    setGuardando(false)
  }

  return (
    <div style={e.fondo}>
      <div style={e.tarjeta}>
        <div style={e.titulo}>Cambia tu contraseña</div>
        <p style={e.bajada}>
          Estás usando una contraseña temporal. Para continuar debes definir
          una propia.
        </p>

        <label style={e.etiqueta}>Nueva contraseña</label>
        <input
          style={e.campo}
          type="password"
          value={nueva}
          onChange={ev => setNueva(ev.target.value)}
          autoComplete="new-password"
        />

        <label style={e.etiqueta}>Confirmar contraseña</label>
        <input
          style={e.campo}
          type="password"
          value={confirmar}
          onChange={ev => setConfirmar(ev.target.value)}
          onKeyDown={ev => ev.key === 'Enter' && guardar()}
          autoComplete="new-password"
        />

        <ul style={e.lista}>
          {estado.cumplidas.map((r, i) => (
            <li key={i} style={{ ...e.regla, color: r.ok ? '#2e7d32' : '#888' }}>
              <span style={e.marca}>{r.ok ? <Check size={14} aria-hidden="true" /> : <Dot size={14} aria-hidden="true" />}</span> {r.texto}
            </li>
          ))}
          <li style={{ ...e.regla, color: nueva && !estado.contieneUsuario ? '#2e7d32' : '#888' }}>
            <span style={e.marca}>{nueva && !estado.contieneUsuario ? <Check size={14} aria-hidden="true" /> : <Dot size={14} aria-hidden="true" />}</span>
            {' '}No contiene tu nombre de usuario
          </li>
          <li style={{ ...e.regla, color: estado.coinciden ? '#2e7d32' : '#888' }}>
            <span style={e.marca}>{estado.coinciden ? <Check size={14} aria-hidden="true" /> : <Dot size={14} aria-hidden="true" />}</span> Las dos coinciden
          </li>
          {nueva && !estado.distinta && (
            <li style={{ ...e.regla, color: '#c62828' }}>
              <span style={e.marca}>×</span> Debe ser distinta de la temporal
            </li>
          )}
        </ul>

        {error && <div style={e.error}>{error}</div>}

        <button
          onClick={guardar}
          disabled={!estado.valida || guardando}
          style={{
            ...e.boton,
            opacity: estado.valida && !guardando ? 1 : 0.45,
            cursor: estado.valida && !guardando ? 'pointer' : 'not-allowed',
          }}
        >
          {guardando ? 'Guardando...' : 'Guardar y continuar'}
        </button>

        <button onClick={onCancelar} style={e.secundario}>
          Volver al inicio de sesión
        </button>
      </div>
    </div>
  )
}

const e = {
  fondo: {
    position: 'fixed', inset: 0, zIndex: 9000,
    background: 'rgba(16,24,40,0.75)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 16, overflowY: 'auto',
  },
  tarjeta: {
    background: '#fff', borderRadius: 'var(--r-tarjeta)', padding: '28px 24px',
    width: '100%', maxWidth: 420, fontFamily: 'Nunito, sans-serif',
    boxShadow: 'var(--sombra-flotante)',
  },
  titulo: { fontSize: 20, fontWeight: 800, color: 'var(--blue)', marginBottom: 6 },
  bajada: { fontSize: 13, color: '#666', lineHeight: 1.5, marginBottom: 18 },
  etiqueta: { display: 'block', fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 6 },
  campo: {
    width: '100%', padding: '12px 14px', border: '2px solid #e8e8e8',
    borderRadius: 'var(--r-control)', fontFamily: 'inherit', fontSize: 15,
    outline: 'none', background: '#fafafa', marginBottom: 14,
  },
  lista: { listStyle: 'none', padding: 0, margin: '4px 0 16px' },
  regla: { fontSize: 12.5, lineHeight: 1.9, display: 'flex', alignItems: 'baseline', gap: 2 },
  marca: { display: 'inline-flex', alignItems: 'center', width: 16, fontWeight: 800 },
  error: {
    padding: '10px 14px', borderRadius: 'var(--r-control)', fontSize: 13, fontWeight: 600,
    background: '#fdecea', color: '#c62828', border: '1px solid #c62828',
    marginBottom: 14,
  },
  boton: {
    width: '100%', padding: 14, border: 'none', borderRadius: 'var(--r-control)',
    background: 'var(--orange)', color: '#fff',
    fontFamily: 'inherit', fontSize: 15, fontWeight: 800,
  },
  secundario: {
    width: '100%', marginTop: 10, padding: 11, borderRadius: 'var(--r-control)',
    border: '2px solid #e0e0e0', background: 'transparent', color: '#666',
    fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer',
  },
}
