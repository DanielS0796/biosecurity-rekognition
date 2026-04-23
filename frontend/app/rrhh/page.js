'use client'
import { useRef, useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { API_RRHH_URL, API_RESET, API_KEY_RRHH } from '../config'

export default function RRHH() {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)

  const [logueado, setLogueado] = useState(false)
  const [usuarioActual, setUsuarioActual] = useState('')
  const [loginUser, setLoginUser] = useState('')
  const [loginPass, setLoginPass] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)

  const [identificacion, setIdentificacion] = useState('')
  const [nombre, setNombre] = useState('')
  const [foto, setFoto] = useState(null)
  const [fotoTomada, setFotoTomada] = useState(false)
  const [regOk, setRegOk] = useState('')
  const [regErr, setRegErr] = useState('')
  const [regLoading, setRegLoading] = useState(false)

  const [eliminarId, setEliminarId] = useState('')
  const [empleadoEncontrado, setEmpleadoEncontrado] = useState(null)
  const [elimOk, setElimOk] = useState('')
  const [elimErr, setElimErr] = useState('')
  const [elimLoading, setElimLoading] = useState(false)
  const [buscarLoading, setBuscarLoading] = useState(false)

  const [activos, setActivos] = useState([])
  const [retirados, setRetirados] = useState([])
  const [mostrarActivos, setMostrarActivos] = useState(false)
  const [mostrarRetirados, setMostrarRetirados] = useState(false)
  const [activosLoading, setActivosLoading] = useState(false)
  const [retiradosLoading, setRetiradosLoading] = useState(false)

  const [nuevoUsuario, setNuevoUsuario] = useState('')
  const [nuevoCorreo, setNuevoCorreo] = useState('')
  const [nuevoPass, setNuevoPass] = useState('')
  const [nuevoPassConfirm, setNuevoPassConfirm] = useState('')
  const [crearOk, setCrearOk] = useState('')
  const [crearErr, setCrearErr] = useState('')
  const [crearLoading, setCrearLoading] = useState(false)
  const [usuarios, setUsuarios] = useState([])
  const [usuariosLoading, setUsuariosLoading] = useState(false)

  const [resetModal, setResetModal] = useState(false)
  const [resetPaso, setResetPaso] = useState(1)
  const [resetEmail, setResetEmail] = useState('')
  const [resetCodigo, setResetCodigo] = useState('')
  const [resetNueva, setResetNueva] = useState('')
  const [resetConfirmar, setResetConfirmar] = useState('')
  const [resetErr, setResetErr] = useState('')
  const [resetOk, setResetOk] = useState('')
  const [resetLoading, setResetLoading] = useState(false)

  useEffect(() => {
    if (logueado) iniciarCamara()
  }, [logueado])

  function playSound(tipo) {
    new Audio(`/${tipo}.mp3`).play().catch(() => {})
  }

  function alerta(set, msg, ms = 4000) {
    set(msg)
    setTimeout(() => set(''), ms)
  }

  async function iniciarCamara() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      if (videoRef.current) videoRef.current.srcObject = stream
    } catch {}
  }

  async function login() {
    setLoginLoading(true)
    setLoginError('')
    try {
      const r = await fetch(API_RESET, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'login', email: loginUser, clave: loginPass })
      })
      const data = await r.json()
      const body = typeof data.body === 'string' ? JSON.parse(data.body) : data
      if (body.codigo === 0 && body.rol.includes('rrhh')) {
        setLogueado(true)
        setUsuarioActual(loginUser)
        setTimeout(() => { cargarUsuarios() }, 500)
      } else {
        setLoginError('Usuario o contraseña incorrectos')
      }
    } catch {
      setLoginError('⚠️ Error de conexión')
    }
    setLoginLoading(false)
  }

  function logout() {
    setLogueado(false)
    setLoginPass('')
    setLoginUser('')
  }

  function tomarFoto() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    setFoto(canvas.toDataURL('image/jpeg', 0.85))
    setFotoTomada(true)
  }

  function repetirFoto() {
    setFoto(null)
    setFotoTomada(false)
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(t => t.stop())
      videoRef.current.srcObject = null
    }
    setTimeout(() => iniciarCamara(), 150)
  }

  async function registrar() {
    if (!identificacion || !nombre || !foto) { alerta(setRegErr, 'Complete todos los campos y tome la foto'); return }
    setRegLoading(true)
    try {
      const r = await fetch(API_RRHH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY_RRHH },
        body: JSON.stringify({ identificacion, nombre, foto })
      })
      const data = await r.json()
      const body = typeof data.body === 'string' ? JSON.parse(data.body) : data
      if (body.codigo === 0) {
        playSound('success')
        alerta(setRegOk, `✅ ${body.nombre} registrado exitosamente`)
        setIdentificacion(''); setNombre(''); repetirFoto()
      } else {
        playSound('error')
        alerta(setRegErr, body.descripcion || 'Error al registrar')
      }
    } catch {
      playSound('error')
      alerta(setRegErr, '⚠️ Sin conexión')
    }
    setRegLoading(false)
  }

  async function buscarEmpleado() {
    if (!eliminarId) { alerta(setElimErr, 'Ingrese el número de identificación'); return }
    setBuscarLoading(true)
    setEmpleadoEncontrado(null)
    try {
      const r = await fetch(`${API_RRHH_URL}?identificacion=${eliminarId}`, { headers: { 'x-api-key': API_KEY_RRHH } })
      const data = await r.json()
      const body = typeof data.body === 'string' ? JSON.parse(data.body) : data
      if (body.codigo === 0 && body.nombre) {
        setEmpleadoEncontrado(body)
      } else {
        alerta(setElimErr, 'No se encontró ningún empleado con esa identificación')
      }
    } catch {
      alerta(setElimErr, '⚠️ Error de conexión')
    }
    setBuscarLoading(false)
  }

  async function confirmarEliminar() {
    setElimLoading(true)
    setEmpleadoEncontrado(null)
    try {
      const r = await fetch(API_RRHH_URL, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY_RRHH },
        body: JSON.stringify({ identificacion: eliminarId })
      })
      const data = await r.json()
      const body = typeof data.body === 'string' ? JSON.parse(data.body) : data
      if (body.codigo === 0) {
        playSound('success')
        alerta(setElimOk, `✅ ${body.descripcion}`)
        setEliminarId('')
      } else {
        playSound('error')
        alerta(setElimErr, body.descripcion || 'Error al eliminar')
      }
    } catch {
      alerta(setElimErr, '⚠️ Error de conexión')
    }
    setElimLoading(false)
  }

  async function toggleActivos() {
    if (mostrarActivos) { setMostrarActivos(false); return }
    setActivosLoading(true)
    try {
      const r = await fetch(`${API_RRHH_URL}?tipo=activos`, { headers: { 'x-api-key': API_KEY_RRHH } })
      const data = await r.json()
      const body = typeof data.body === 'string' ? JSON.parse(data.body) : data
      setActivos(body.items || [])
      setMostrarActivos(true)
    } catch {}
    setActivosLoading(false)
  }

  async function toggleRetirados() {
    if (mostrarRetirados) { setMostrarRetirados(false); return }
    setRetiradosLoading(true)
    try {
      const r = await fetch(`${API_RRHH_URL}?tipo=retirados`, { headers: { 'x-api-key': API_KEY_RRHH } })
      const data = await r.json()
      const body = typeof data.body === 'string' ? JSON.parse(data.body) : data
      setRetirados(body.items || [])
      setMostrarRetirados(true)
    } catch {}
    setRetiradosLoading(false)
  }

  async function crearUsuario() {
    if (!nuevoUsuario.trim() || !nuevoCorreo.trim() || !nuevoPass.trim()) { alerta(setCrearErr, 'Complete todos los campos'); return }
    if (nuevoPass !== nuevoPassConfirm) { alerta(setCrearErr, 'Las contraseñas no coinciden'); return }
    if (nuevoPass.length < 6) { alerta(setCrearErr, 'La contraseña debe tener al menos 6 caracteres'); return }
    setCrearLoading(true)
    try {
      const r = await fetch(API_RESET, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'crear_usuario', usuario: nuevoUsuario.trim(), correo: nuevoCorreo.trim(), clave: nuevoPass.trim() })
      })
      const data = await r.json()
      const body = typeof data.body === 'string' ? JSON.parse(data.body) : data
      if (body.codigo === 0) {
        playSound('success')
        alerta(setCrearOk, `✅ ${body.descripcion}`)
        setNuevoUsuario(''); setNuevoCorreo(''); setNuevoPass(''); setNuevoPassConfirm('')
        cargarUsuarios()
      } else {
        playSound('error')
        alerta(setCrearErr, body.descripcion || 'Error al crear usuario')
      }
    } catch {
      alerta(setCrearErr, '⚠️ Error de conexión')
    }
    setCrearLoading(false)
  }

  async function cargarUsuarios() {
    setUsuariosLoading(true)
    try {
      const r = await fetch(API_RESET, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'listar_usuarios' })
      })
      const data = await r.json()
      const body = typeof data.body === 'string' ? JSON.parse(data.body) : data
      setUsuarios(body.items || [])
    } catch {}
    setUsuariosLoading(false)
  }

  async function eliminarUsuario(usuario) {
    if (!confirm(`¿Eliminar el usuario "${usuario}"?`)) return
    try {
      const r = await fetch(API_RESET, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'eliminar_usuario', usuario, usuario_actual: usuarioActual })
      })
      const data = await r.json()
      const body = typeof data.body === 'string' ? JSON.parse(data.body) : data
      if (body.codigo === 0) { playSound('success'); cargarUsuarios() }
      else { playSound('error'); alert(body.descripcion || 'Error al eliminar') }
    } catch { alert('⚠️ Error de conexión') }
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
  const btnSecondary = { width: '100%', padding: 14, border: '2px solid var(--blue)', borderRadius: 14, background: 'transparent', color: 'var(--blue)', fontFamily: 'Nunito, sans-serif', fontSize: 14, fontWeight: 700, cursor: 'pointer' }
  const alertOk = { padding: '12px 16px', borderRadius: 12, fontSize: 14, fontWeight: 700, background: '#e8f5e9', color: '#2e7d32', border: '2px solid #2e7d32' }
  const alertErr = { padding: '12px 16px', borderRadius: 12, fontSize: 14, fontWeight: 700, background: '#fdecea', color: '#c62828', border: '2px solid #c62828' }

  const Fondo = () => (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: '1fr 1fr 1fr', height: '100%' }}>
        {['#F05A22,#FF8C42','#4B2D8F,#6B4CC0','#00B4D8,#0077A8','#1A2D5A,#2D4A8A','#F05A22,#4B2D8F','#00B4D8,#4B2D8F','#4B2D8F,#00B4D8','#1A2D5A,#F05A22','#F05A22,#1A2D5A'].map((g, i) => (
          <div key={i} style={{ background: `linear-gradient(135deg, ${g})`, filter: 'saturate(0.6) brightness(0.7)' }} />
        ))}
      </div>
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(160deg, rgba(75,45,143,0.75) 0%, rgba(26,45,90,0.85) 50%, rgba(75,45,143,0.75) 100%)' }} />
      <div style={{ position: 'absolute', width: 300, height: 300, borderRadius: '50%', background: 'rgba(240,90,34,0.35)', top: -80, left: -80 }} />
      <div style={{ position: 'absolute', width: 250, height: 250, borderRadius: '50%', background: 'rgba(0,180,216,0.25)', bottom: 100, right: -60 }} />
    </div>
  )

  if (!logueado) return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <Fondo />
      <div style={{ position: 'relative', zIndex: 1, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{ padding: '40px 20px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <Link href="/" style={{ alignSelf: 'flex-start', background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', fontFamily: 'Nunito, sans-serif', fontSize: 14, fontWeight: 700, padding: '8px 16px', borderRadius: 20, cursor: 'pointer', textDecoration: 'none' }}>← Volver</Link>
          <Image src="/Logocomp.png" alt="UCompensar" width={120} height={44} style={{ objectFit: 'contain', filter: 'brightness(0) invert(1)', marginTop: 8 }} />
          <div style={{ color: 'white', fontSize: 13, fontWeight: 700, letterSpacing: 1, textAlign: 'center' }}>
            PANEL RECURSOS HUMANOS<br />
            <span style={{ fontWeight: 400, fontSize: 11, opacity: 0.8 }}>Registro de Personal</span>
          </div>
        </div>
        <div>
          <div style={{ ...cardStyle, borderRadius: '24px 24px 0 0', margin: 0, marginTop: -60 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--blue)', marginBottom: 4 }}>Iniciar Sesión</div>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 18 }}>Ingresa tus credenciales para continuar</div>
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

      {/* MODAL RESET */}
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
              <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>Ingresa el código de 6 dígitos que enviamos a tu correo.</p>
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
          <button style={{ flex: 1, padding: '10px 6px', border: '1.5px solid var(--orange)', borderRadius: 12, background: 'var(--orange)', color: 'white', fontFamily: 'Nunito, sans-serif', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 18 }}>👥</span><span>Registro</span>
          </button>
          <Link href="/auditoria" style={{ flex: 1, padding: '10px 6px', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: 12, background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)', fontFamily: 'Nunito, sans-serif', fontSize: 11, fontWeight: 700, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
            <span style={{ fontSize: 18 }}>📊</span><span>Auditoría</span>
          </Link>
        </div>

        {/* CONTENIDO */}
        <div style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* REGISTRAR */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--blue)' }}>Registrar Empleado</div>
                <div style={{ fontSize: 13, color: '#666' }}>Complete los datos y tome la foto</div>
              </div>
              <button onClick={logout} style={{ background: 'var(--blue)', border: 'none', color: 'white', fontFamily: 'Nunito, sans-serif', fontSize: 12, fontWeight: 700, padding: '8px 16px', borderRadius: 20, cursor: 'pointer' }}>Cerrar sesión</button>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 6 }}>Número de identificación</label>
              <input style={inputStyle} type="text" placeholder="Ej: 1234567890" value={identificacion} onChange={e => setIdentificacion(e.target.value)} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 6 }}>Nombre completo</label>
              <input style={inputStyle} type="text" placeholder="Ej: Juan Pérez" value={nombre} onChange={e => setNombre(e.target.value)} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 6 }}>Foto del empleado</label>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                {!fotoTomada && <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', background: '#000', width: '100%', maxWidth: 280, aspectRatio: '3/4', maxHeight: 220 }}>
                  <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>}
                {fotoTomada && foto && <img src={foto} alt="preview" style={{ maxWidth: 280, borderRadius: 12, marginTop: 10 }} />}
                <canvas ref={canvasRef} style={{ display: 'none' }} />
              </div>
            </div>
            {!fotoTomada && <button style={btnPrimary} onClick={tomarFoto}>📷 Tomar Foto</button>}
            {fotoTomada && <>
              <button style={{ ...btnSecondary, marginBottom: 8 }} onClick={repetirFoto}>🔄 Repetir Foto</button>
              <button style={{ ...btnPrimary, background: 'var(--blue)' }} onClick={registrar} disabled={regLoading}>{regLoading ? '⏳ Registrando...' : '✅ Registrar Empleado'}</button>
            </>}
            {regOk && <div style={{ ...alertOk, marginTop: 10 }}>{regOk}</div>}
            {regErr && <div style={{ ...alertErr, marginTop: 10 }}>{regErr}</div>}
          </div>

          {/* ELIMINAR */}
          <div style={{ ...cardStyle, border: '2px solid #fee2e2' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#c62828', marginBottom: 6 }}>🗑️ Eliminar Empleado</div>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 14 }}>Busque al empleado antes de eliminar</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 6 }}>Número de identificación</label>
                <input style={inputStyle} type="text" placeholder="Ej: 1234567890" value={eliminarId} onChange={e => setEliminarId(e.target.value)} onKeyDown={e => e.key === 'Enter' && buscarEmpleado()} />
              </div>
              <button onClick={buscarEmpleado} style={{ padding: '13px 16px', border: 'none', borderRadius: 12, background: 'var(--blue)', color: 'white', fontSize: 18, cursor: 'pointer' }}>🔍</button>
            </div>
            {buscarLoading && <div style={{ textAlign: 'center', color: '#888', fontSize: 13 }}>⏳ Buscando...</div>}
            {empleadoEncontrado && (
              <div style={{ marginTop: 10, padding: 16, background: '#fff3e0', borderRadius: 12, border: '2px solid #FF9800' }}>
                <div style={{ fontSize: 13, color: '#888', marginBottom: 4 }}>Empleado encontrado:</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--blue)' }}>{empleadoEncontrado.nombre}</div>
                <div style={{ fontSize: 13, color: '#666', marginTop: 2 }}>CC: {eliminarId}</div>
                <div style={{ marginTop: 14, padding: 10, background: '#fdecea', borderRadius: 8, fontSize: 13, color: '#c62828', fontWeight: 600 }}>
                  ⚠️ Esta acción eliminará al empleado y no se puede deshacer
                </div>
                <button onClick={confirmarEliminar} style={{ width: '100%', marginTop: 12, padding: 13, border: 'none', borderRadius: 12, background: '#c62828', color: 'white', fontFamily: 'Nunito, sans-serif', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>✅ Confirmar Eliminación</button>
                <button onClick={() => { setEmpleadoEncontrado(null); setEliminarId('') }} style={{ width: '100%', marginTop: 8, padding: 11, border: '2px solid #888', borderRadius: 12, background: 'transparent', color: '#666', fontFamily: 'Nunito, sans-serif', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
              </div>
            )}
            {elimLoading && <div style={{ textAlign: 'center', color: '#888', fontSize: 13, marginTop: 8 }}>⏳ Eliminando...</div>}
            {elimOk && <div style={{ ...alertOk, marginTop: 10 }}>{elimOk}</div>}
            {elimErr && <div style={{ ...alertErr, marginTop: 10 }}>{elimErr}</div>}
          </div>

          {/* ACTIVOS */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#2e7d32' }}>👥 Trabajadores Activos</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{activos.length > 0 ? `${activos.length} empleado${activos.length !== 1 ? 's' : ''}` : '—'}</div>
              </div>
              <button onClick={toggleActivos} style={{ background: 'var(--blue)', border: 'none', color: 'white', fontFamily: 'Nunito, sans-serif', fontSize: 12, fontWeight: 700, padding: '8px 14px', borderRadius: 20, cursor: 'pointer' }}>
                {activosLoading ? '⏳' : mostrarActivos ? 'Ocultar' : 'Ver todos'}
              </button>
            </div>
            {mostrarActivos && (activos.length === 0
              ? <div style={{ textAlign: 'center', padding: '40px 20px', color: '#aaa', fontSize: 14 }}>No hay empleados activos</div>
              : activos.map(e => (
                <div key={e.identificacion} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <div>
                    <div style={{ fontWeight: 800, color: 'var(--blue)', fontSize: 14 }}>{e.nombre}</div>
                    <div style={{ fontSize: 12, color: '#888' }}>CC: {e.identificacion}</div>
                  </div>
                  <div style={{ width: 10, height: 10, background: '#2e7d32', borderRadius: '50%' }} />
                </div>
              ))
            )}
          </div>

          {/* RETIRADOS */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#c62828' }}>🚪 Trabajadores Retirados</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{retirados.length > 0 ? `${retirados.length} retirado${retirados.length !== 1 ? 's' : ''}` : '—'}</div>
              </div>
              <button onClick={toggleRetirados} style={{ background: '#c62828', border: 'none', color: 'white', fontFamily: 'Nunito, sans-serif', fontSize: 12, fontWeight: 700, padding: '8px 14px', borderRadius: 20, cursor: 'pointer' }}>
                {retiradosLoading ? '⏳' : mostrarRetirados ? 'Ocultar' : 'Ver todos'}
              </button>
            </div>
            {mostrarRetirados && (retirados.length === 0
              ? <div style={{ textAlign: 'center', padding: '40px 20px', color: '#aaa', fontSize: 14 }}>No hay empleados retirados</div>
              : retirados.map(e => (
                <div key={e.identificacion} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <div>
                    <div style={{ fontWeight: 800, color: '#c62828', fontSize: 14 }}>{e.nombre}</div>
                    <div style={{ fontSize: 12, color: '#888' }}>CC: {e.identificacion}</div>
                  </div>
                  <div style={{ width: 10, height: 10, background: '#c62828', borderRadius: '50%' }} />
                </div>
              ))
            )}
          </div>

          {/* GESTIÓN USUARIOS */}
          <div style={{ ...cardStyle, border: '2px solid #e8e0ff' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#4B2D8F', marginBottom: 6 }}>👤 Gestión de Usuarios</div>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>Administra los usuarios con acceso al sistema</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1A2D5A', marginBottom: 10 }}>➕ Crear nuevo usuario</div>
            <div style={{ marginBottom: 14 }}><label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 6 }}>Usuario institucional</label><input style={inputStyle} type="text" placeholder="Ej: jperez" value={nuevoUsuario} onChange={e => setNuevoUsuario(e.target.value)} /></div>
            <div style={{ marginBottom: 14 }}><label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 6 }}>Correo electrónico</label><input style={inputStyle} type="email" placeholder="correo@ejemplo.com" value={nuevoCorreo} onChange={e => setNuevoCorreo(e.target.value)} /></div>
            <div style={{ marginBottom: 14 }}><label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 6 }}>Contraseña</label><input style={inputStyle} type="password" placeholder="••••••••" value={nuevoPass} onChange={e => setNuevoPass(e.target.value)} /></div>
            <div style={{ marginBottom: 14 }}><label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 6 }}>Confirmar contraseña</label><input style={inputStyle} type="password" placeholder="••••••••" value={nuevoPassConfirm} onChange={e => setNuevoPassConfirm(e.target.value)} /></div>
            {crearErr && <div style={{ ...alertErr, marginBottom: 10 }}>{crearErr}</div>}
            {crearOk && <div style={{ ...alertOk, marginBottom: 10 }}>{crearOk}</div>}
            <button style={btnPrimary} onClick={crearUsuario} disabled={crearLoading}>{crearLoading ? '⏳ Creando...' : 'Crear usuario'}</button>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1A2D5A' }}>👥 Usuarios registrados</div>
              <button onClick={cargarUsuarios} style={{ background: 'var(--blue)', border: 'none', color: 'white', fontFamily: 'Nunito, sans-serif', fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 16, cursor: 'pointer' }}>Actualizar</button>
            </div>
            {usuariosLoading && <div style={{ textAlign: 'center', color: '#888', fontSize: 13 }}>⏳ Cargando...</div>}
            {usuarios.map(u => (
              <div key={u.usuario} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f0f0f0' }}>
                <div>
                  <div style={{ fontWeight: 800, color: '#1A2D5A', fontSize: 14 }}>{u.usuario}</div>
                  <div style={{ fontSize: 12, color: '#888' }}>{u.correo || 'Sin correo registrado'}</div>
                </div>
                {u.usuario !== usuarioActual
                  ? <button onClick={() => eliminarUsuario(u.usuario)} style={{ background: '#fdecea', border: 'none', color: '#c62828', fontFamily: 'Nunito, sans-serif', fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 16, cursor: 'pointer' }}>🗑️ Eliminar</button>
                  : <span style={{ fontSize: 11, color: '#888', fontStyle: 'italic' }}>Tú</span>
                }
              </div>
            ))}
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
