'use client'
import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { API_AUDITORIA, API_RESET, API_KEY_AUD } from '../config'
import CambioClaveObligatorio from '../components/CambioClaveObligatorio'

export default function Auditoria() {
  const [logueado, setLogueado] = useState(false)
  const [usuarioActual, setUsuarioActual] = useState('')
  const [loginUser, setLoginUser] = useState('')
  const [loginPass, setLoginPass] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  // Quien entra con una contraseña temporal no pasa al sistema: primero
  // la cambia. Se guarda la temporal para poder probar el cambio.
  const [cambioPendiente, setCambioPendiente] = useState(null)

  const [datos, setDatos] = useState([])
  const [loading, setLoading] = useState(false)
  const [fechaDesde, setFechaDesde] = useState(() => new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0])
  const [fechaHasta, setFechaHasta] = useState(() => new Date().toISOString().split('T')[0])
  const [errorCarga, setErrorCarga] = useState('')
  const [exportando, setExportando] = useState(false)

  const [resetModal, setResetModal] = useState(false)
  const [resetPaso, setResetPaso] = useState(1)
  const [resetEmail, setResetEmail] = useState('')
  const [resetCodigo, setResetCodigo] = useState('')
  const [resetNueva, setResetNueva] = useState('')
  const [resetConfirmar, setResetConfirmar] = useState('')
  const [resetErr, setResetErr] = useState('')
  const [resetOk, setResetOk] = useState('')
  const [resetLoading, setResetLoading] = useState(false)

  async function login() {
    setLoginLoading(true); setLoginError('')
    try {
      const r = await fetch(API_RESET, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'login', email: loginUser.trim(), clave: loginPass.trim() })
      })
      const data = await r.json()
      const body = typeof data.body === 'string' ? JSON.parse(data.body) : data
      if (body.codigo === 0 && body.rol.includes('auditoria')) {
        if (body.debe_cambiar_clave) {
          setCambioPendiente({ usuario: loginUser.trim(), clave: loginPass.trim() })
        } else {
        setLogueado(true)
        setUsuarioActual(loginUser)
        cargarAuditoria()
        }
      } else {
        setLoginError('Usuario o contraseña incorrectos')
      }
    } catch { setLoginError('⚠️ Error de conexión') }
    setLoginLoading(false)
  }

  function logout() {
    setLogueado(false)
    setLoginPass('')
    setLoginUser('')
    setDatos([])
  }

  // El filtro de fechas lo resuelve el servidor. Antes el Lambda devolvía
  // solo los 50 registros más recientes y el recorte por fecha se hacía acá,
  // sobre ese puñado: buscar algo de meses atrás no devolvía nada porque esos
  // registros nunca llegaban al navegador.
  async function cargarAuditoria() {
    setLoading(true)
    setErrorCarga('')
    try {
      const params = new URLSearchParams({ format: 'json' })
      if (fechaDesde) params.set('desde', fechaDesde)
      if (fechaHasta) params.set('hasta', fechaHasta)

      const r = await fetch(`${API_AUDITORIA}?${params}`, { headers: { 'x-api-key': API_KEY_AUD } })
      const data = await r.json()
      const body = typeof data.body === 'string' ? JSON.parse(data.body) : data
      setDatos(body.items || [])
    } catch (err) {
      setDatos([])
      setErrorCarga('No se pudieron cargar los registros: ' + err.message)
    }
    setLoading(false)
  }

  // Excel en configuración regional de español trata la coma como separador
  // decimal, no de columnas, así que un CSV con comas cae entero en la
  // primera columna. Se genera un .xlsx de verdad, con encabezados y anchos.
  // La librería se carga en este momento y no al abrir la página, para no
  // sumarle peso a la carga inicial.
  async function exportarExcel() {
    if (!datos.length) { alert('No hay registros para exportar. Presione Buscar primero.'); return }
    setExportando(true)
    try {
      const ExcelJS = (await import('exceljs')).default
      const libro = new ExcelJS.Workbook()
      libro.creator = 'Biosecurity UCompensar'
      libro.created = new Date()

      const hoja = libro.addWorksheet('Accesos', {
        views: [{ state: 'frozen', ySplit: 1 }],
      })

      hoja.columns = [
        { header: 'Identificación', key: 'identificacion', width: 18 },
        { header: 'Nombre', key: 'nombre', width: 32 },
        { header: 'Fecha', key: 'fecha', width: 14 },
        { header: 'Hora entrada', key: 'entrada', width: 14 },
        { header: 'Hora salida', key: 'salida', width: 14 },
        { header: 'Método', key: 'metodo', width: 14 },
      ]

      hoja.getRow(1).eachCell(celda => {
        celda.font = { bold: true, color: { argb: 'FFFFFFFF' } }
        celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A2D5A' } }
        celda.alignment = { vertical: 'middle', horizontal: 'left' }
      })
      hoja.getRow(1).height = 22

      datos.forEach(i => {
        const fila = hoja.addRow({
          identificacion: i.identificacion || '',
          nombre: i.nombre || '',
          fecha: i.fecha || '',
          entrada: i.hora_entrada || '',
          salida: i.hora_salida || 'Sin salida',
          metodo: i.metodo === 'liveness' ? 'Persona viva' : (i.metodo || ''),
        })
        if (!i.hora_salida) {
          fila.getCell('salida').font = { color: { argb: 'FF999999' }, italic: true }
        }
      })

      // Deja la fila de encabezados como filtro, que es lo que vuelve
      // utilizable un reporte de varios cientos de filas.
      hoja.autoFilter = { from: 'A1', to: `F${datos.length + 1}` }

      const buffer = await libro.xlsx.writeBuffer()
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `accesos_${fechaDesde}_a_${fechaHasta}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert('No se pudo generar el archivo: ' + err.message)
    }
    setExportando(false)
  }

  async function solicitarCodigo() {
    if (!resetEmail) { setResetErr('Ingresa tu usuario'); return }
    setResetLoading(true); setResetErr(''); setResetOk('')
    try {
      const r = await fetch(API_RESET, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'solicitar', email: resetEmail })
      })
      const data = await r.json()
      const body = typeof data.body === 'string' ? JSON.parse(data.body) : data
      if (body.codigo === 0) {
        setResetOk('✅ Código enviado a tu correo')
        setTimeout(() => { setResetPaso(2); setResetErr(''); setResetOk('') }, 1500)
      } else setResetErr(body.descripcion || 'Error al enviar código')
    } catch { setResetErr('⚠️ Error de conexión') }
    setResetLoading(false)
  }

  async function verificarCodigo() {
    if (!resetCodigo || resetCodigo.length !== 6) { setResetErr('Ingresa el código de 6 dígitos'); return }
    setResetLoading(true); setResetErr('')
    try {
      const r = await fetch(API_RESET, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'verificar', email: resetEmail, codigo: resetCodigo })
      })
      const data = await r.json()
      const body = typeof data.body === 'string' ? JSON.parse(data.body) : data
      if (body.codigo === 0) { setResetPaso(3); setResetErr('') }
      else setResetErr(body.descripcion || 'Código incorrecto')
    } catch { setResetErr('⚠️ Error de conexión') }
    setResetLoading(false)
  }

  async function cambiarClave() {
    if (!resetNueva || resetNueva.length < 6) { setResetErr('Mínimo 6 caracteres'); return }
    if (resetNueva !== resetConfirmar) { setResetErr('Las contraseñas no coinciden'); return }
    setResetLoading(true); setResetErr('')
    try {
      const r = await fetch(API_RESET, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'cambiar', email: resetEmail, codigo: resetCodigo, nueva_clave: resetNueva })
      })
      const data = await r.json()
      const body = typeof data.body === 'string' ? JSON.parse(data.body) : data
      if (body.codigo === 0) {
        setResetOk('✅ Contraseña actualizada')
        setTimeout(() => { setResetModal(false); setResetPaso(1) }, 2000)
      } else setResetErr(body.descripcion || 'Error al cambiar contraseña')
    } catch { setResetErr('⚠️ Error de conexión') }
    setResetLoading(false)
  }

  const cardStyle = { background: 'rgba(255,255,255,0.75)', borderRadius: 20, padding: '24px 20px', backdropFilter: 'blur(20px)', boxShadow: '0 8px 32px rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.4)' }
  const inputStyle = { width: '100%', padding: '13px 16px', border: '2px solid #e8e8e8', borderRadius: 12, fontFamily: 'Nunito, sans-serif', fontSize: 15, outline: 'none', background: '#fafafa' }
  const btnPrimary = { width: '100%', padding: 16, border: 'none', borderRadius: 14, background: 'var(--orange)', color: 'white', fontFamily: 'Nunito, sans-serif', fontSize: 16, fontWeight: 800, cursor: 'pointer', boxShadow: '0 4px 15px rgba(240,90,34,0.35)' }
  const alertErr = { padding: '12px 16px', borderRadius: 12, fontSize: 14, fontWeight: 700, background: '#fdecea', color: '#c62828', border: '2px solid #c62828' }
  const alertOk = { padding: '12px 16px', borderRadius: 12, fontSize: 14, fontWeight: 700, background: '#e8f5e9', color: '#2e7d32', border: '2px solid #2e7d32' }

  const Fondo = () => (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: '1fr 1fr 1fr', height: '100%' }}>
        {['#F05A22,#FF8C42', '#4B2D8F,#6B4CC0', '#00B4D8,#0077A8', '#1A2D5A,#2D4A8A', '#F05A22,#4B2D8F', '#00B4D8,#4B2D8F', '#4B2D8F,#00B4D8', '#1A2D5A,#F05A22', '#F05A22,#1A2D5A'].map((g, i) => (
          <div key={i} style={{ background: `linear-gradient(135deg, ${g})`, filter: 'saturate(0.6) brightness(0.7)' }} />
        ))}
      </div>
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(160deg, rgba(75,45,143,0.75) 0%, rgba(26,45,90,0.85) 50%, rgba(75,45,143,0.75) 100%)' }} />
      <div style={{ position: 'absolute', width: 300, height: 300, borderRadius: '50%', background: 'rgba(240,90,34,0.35)', top: -80, left: -80 }} />
      <div style={{ position: 'absolute', width: 250, height: 250, borderRadius: '50%', background: 'rgba(0,180,216,0.25)', bottom: 100, right: -60 }} />
    </div>
  )

  if (cambioPendiente) return (
    <CambioClaveObligatorio
      usuario={cambioPendiente.usuario}
      claveActual={cambioPendiente.clave}
      onListo={() => {
        setCambioPendiente(null)
        setLoginPass('')
        alert('Contraseña actualizada. Ingresa de nuevo con la contraseña que acabas de definir.')
      }}
      onCancelar={() => { setCambioPendiente(null); setLoginPass('') }}
    />
  )

  if (!logueado) return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <Fondo />
      <div style={{ position: 'relative', zIndex: 1, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{ padding: '40px 20px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <Link href="/" style={{ alignSelf: 'flex-start', background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', fontFamily: 'Nunito, sans-serif', fontSize: 14, fontWeight: 700, padding: '8px 16px', borderRadius: 20, cursor: 'pointer', textDecoration: 'none' }}>← Volver</Link>
          <Image src="/Logocomp.png" alt="UCompensar" width={120} height={44} style={{ objectFit: 'contain', filter: 'brightness(0) invert(1)', marginTop: 8 }} />
          <div style={{ color: 'white', fontSize: 13, fontWeight: 700, letterSpacing: 1, textAlign: 'center' }}>
            PANEL DE AUDITORÍA<br />
            <span style={{ fontWeight: 400, fontSize: 11, opacity: 0.8 }}>Control y Reportes</span>
          </div>
        </div>
        <div>
          <div style={{ ...cardStyle, borderRadius: '24px 24px 0 0', marginTop: -60 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--blue)', marginBottom: 4 }}>Acceso Administrativo</div>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 18 }}>Solo personal autorizado</div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 6 }}>Usuario</label>
              <input style={inputStyle} type="text" placeholder="Ingrese su usuario" value={loginUser} onChange={e => setLoginUser(e.target.value)} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 6 }}>Contraseña</label>
              <input style={inputStyle} type="password" placeholder="••••••••" value={loginPass} onChange={e => setLoginPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && login()} />
            </div>
            {loginError && <div style={{ ...alertErr, marginBottom: 10 }}>{loginError}</div>}
            <button style={btnPrimary} onClick={login} disabled={loginLoading}>{loginLoading ? 'Verificando...' : 'Ingresar'}</button>
            <button onClick={() => { setResetModal(true); setResetPaso(1) }} style={{ width: '100%', marginTop: 8, background: 'none', border: 'none', color: '#4B2D8F', fontFamily: 'Nunito, sans-serif', fontSize: 13, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>
              ¿Olvidaste tu contraseña?
            </button>
          </div>
          <div style={{ background: 'var(--orange)', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Image src="/Logocomp.png" alt="UCompensar" width={80} height={28} style={{ objectFit: 'contain', filter: 'brightness(0) invert(1)' }} />
          </div>
        </div>
      </div>

      {resetModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: 20, padding: 28, width: '90%', maxWidth: 380 }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 32 }}>🔐</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#1A2D5A' }}>Restablecer contraseña</div>
            </div>
            {resetPaso === 1 && <>
              <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>Ingresa tu usuario y te enviaremos un código al correo registrado.</p>
              <div style={{ marginBottom: 14 }}><label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 6 }}>Usuario institucional</label><input style={inputStyle} type="text" placeholder="Usuario institucional" value={resetEmail} onChange={e => setResetEmail(e.target.value)} /></div>
              {resetErr && <div style={{ ...alertErr, marginBottom: 10 }}>{resetErr}</div>}
              {resetOk && <div style={{ ...alertOk, marginBottom: 10 }}>{resetOk}</div>}
              <button style={btnPrimary} onClick={solicitarCodigo} disabled={resetLoading}>{resetLoading ? '⏳ Enviando...' : 'Enviar código'}</button>
            </>}
            {resetPaso === 2 && <>
              <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>Ingresa el código de 6 dígitos enviado a tu correo.</p>
              <div style={{ marginBottom: 14 }}><label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 6 }}>Código</label><input style={{ ...inputStyle, letterSpacing: 8, fontSize: 20, textAlign: 'center' }} type="text" placeholder="000000" maxLength={6} value={resetCodigo} onChange={e => setResetCodigo(e.target.value)} /></div>
              {resetErr && <div style={{ ...alertErr, marginBottom: 10 }}>{resetErr}</div>}
              <button style={btnPrimary} onClick={verificarCodigo} disabled={resetLoading}>{resetLoading ? '⏳ Verificando...' : 'Verificar código'}</button>
            </>}
            {resetPaso === 3 && <>
              <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>Ingresa tu nueva contraseña.</p>
              <div style={{ marginBottom: 14 }}><label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 6 }}>Nueva contraseña</label><input style={inputStyle} type="password" placeholder="••••••••" value={resetNueva} onChange={e => setResetNueva(e.target.value)} /></div>
              <div style={{ marginBottom: 14 }}><label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 6 }}>Confirmar</label><input style={inputStyle} type="password" placeholder="••••••••" value={resetConfirmar} onChange={e => setResetConfirmar(e.target.value)} /></div>
              {resetErr && <div style={{ ...alertErr, marginBottom: 10 }}>{resetErr}</div>}
              {resetOk && <div style={{ ...alertOk, marginBottom: 10 }}>{resetOk}</div>}
              <button style={btnPrimary} onClick={cambiarClave} disabled={resetLoading}>{resetLoading ? '⏳ Guardando...' : 'Guardar contraseña'}</button>
            </>}
            <button onClick={() => setResetModal(false)} style={{ width: '100%', marginTop: 12, background: 'none', border: '2px solid #ddd', borderRadius: 12, padding: 10, fontFamily: 'Nunito, sans-serif', fontSize: 14, fontWeight: 700, color: '#888', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <Fondo />
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        {/* HEADER */}
        <div style={{ padding: '20px 20px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <Image src="/Logocomp.png" alt="UCompensar" width={120} height={36} style={{ objectFit: 'contain', filter: 'brightness(0) invert(1)' }} />
          <div style={{ color: 'white', fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', opacity: 0.9 }}>Sistema Biosecurity</div>
        </div>

        {/* NAVBAR */}
        <div style={{ display: 'flex', gap: 6, padding: '14px 16px 0' }}>
          <Link href="/" style={{ flex: 1, padding: '10px 6px', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: 12, background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)', fontFamily: 'Nunito, sans-serif', fontSize: 11, fontWeight: 700, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
            <span style={{ fontSize: 18 }}>🔐</span><span>Acceso</span>
          </Link>
          <Link href="/rrhh" style={{ flex: 1, padding: '10px 6px', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: 12, background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)', fontFamily: 'Nunito, sans-serif', fontSize: 11, fontWeight: 700, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
            <span style={{ fontSize: 18 }}>👥</span><span>Registro</span>
          </Link>
          <button style={{ flex: 1, padding: '10px 6px', border: '1.5px solid var(--orange)', borderRadius: 12, background: 'var(--orange)', color: 'white', fontFamily: 'Nunito, sans-serif', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 18 }}>📊</span><span>Auditoría</span>
          </button>
        </div>

        {/* CONTENIDO */}
        <div style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* STATS */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {[
              { num: datos.length, lbl: 'Total', color: 'var(--blue)' },
              { num: datos.filter(i => i.hora_salida).length, lbl: 'Con salida', color: '#2e7d32' },
              { num: datos.filter(i => !i.hora_salida).length, lbl: 'Sin salida', color: '#c62828' }
            ].map((s, i) => (
              <div key={i} style={{ background: 'rgba(255,255,255,0.92)', borderRadius: 14, padding: '14px 8px', textAlign: 'center', boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }}>
                <div style={{ fontSize: 26, fontWeight: 900, color: s.color }}>{s.num}</div>
                <div style={{ fontSize: 11, color: '#666', marginTop: 2, fontWeight: 600 }}>{s.lbl}</div>
              </div>
            ))}
          </div>

          {/* TABLA */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--blue)' }}>Registro de Accesos</div>
              <button onClick={logout} style={{ background: 'var(--blue)', border: 'none', color: 'white', fontFamily: 'Nunito, sans-serif', fontSize: 12, fontWeight: 700, padding: '8px 16px', borderRadius: 20, cursor: 'pointer' }}>Cerrar sesión</button>
            </div>

            {/* FILTROS */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 130 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 6 }}>Desde</label>
                <input style={{ ...inputStyle, padding: '11px 12px', fontSize: 13 }} type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)} />
              </div>
              <div style={{ flex: 1, minWidth: 130 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 6 }}>Hasta</label>
                <input style={{ ...inputStyle, padding: '11px 12px', fontSize: 13 }} type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <button onClick={cargarAuditoria} disabled={loading} style={{ flex: 1, padding: 12, border: 'none', borderRadius: 14, background: 'var(--orange)', color: 'white', fontFamily: 'Nunito, sans-serif', fontSize: 13, fontWeight: 800, cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1 }}>
                {loading ? 'Buscando...' : 'Buscar'}
              </button>
              <button onClick={exportarExcel} disabled={exportando || !datos.length} style={{ flex: 1, padding: 12, border: 'none', borderRadius: 14, background: 'var(--blue)', color: 'white', fontFamily: 'Nunito, sans-serif', fontSize: 13, fontWeight: 800, cursor: exportando ? 'wait' : 'pointer', opacity: (exportando || !datos.length) ? 0.5 : 1 }}>
                {exportando ? 'Generando...' : 'Exportar a Excel'}
              </button>
            </div>

            {errorCarga && <div style={{ ...alertErr, marginBottom: 14 }}>{errorCarga}</div>}

            {datos.length === 0
              ? <div style={{ textAlign: 'center', padding: '40px 20px', color: '#aaa', fontSize: 14 }}>
                  {loading ? '⏳ Cargando registros...' : 'No hay registros en este período'}
                </div>
              : <div style={{ overflowX: 'auto', borderRadius: 14 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr>
                        {['Identificación', 'Nombre', 'Fecha', 'Entrada', 'Salida'].map((h, i, arr) => (
                          <th key={i} style={{ background: 'var(--blue)', color: 'white', padding: '11px 12px', textAlign: 'left', fontWeight: 700, borderRadius: i === 0 ? '10px 0 0 0' : i === arr.length - 1 ? '0 10px 0 0' : 0 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {datos.map((item, i) => (
                        <tr key={i}>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid #f0f0f0', fontWeight: 700 }}>{item.identificacion || '-'}</td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid #f0f0f0' }}>{item.nombre || '-'}</td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid #f0f0f0', whiteSpace: 'nowrap' }}>{item.fecha || '-'}</td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid #f0f0f0', color: '#2e7d32', fontWeight: 600 }}>{item.hora_entrada || '-'}</td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid #f0f0f0', color: item.hora_salida ? '#c62828' : '#888', fontWeight: item.hora_salida ? 600 : 400 }}>
                            {item.hora_salida || 'Sin salida'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
            }
          </div>

        </div>

        {/* FOOTER */}
        <div style={{ background: 'var(--orange)', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Image src="/Logocomp.png" alt="UCompensar" width={80} height={30} style={{ objectFit: 'contain', filter: 'brightness(0) invert(1)' }} />
        </div>
      </div>
    </div>
  )
}
