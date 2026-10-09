'use client'
import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { API_RRHH_URL, API_RESET, API_KEY_RRHH } from '../config'
import LivenessScan from '../components/LivenessScan'
import CambioClaveObligatorio from '../components/CambioClaveObligatorio'
import ConsentimientoDatos from '../components/ConsentimientoDatos'
import { ArrowLeft, BarChart3, Check, DoorOpen, LoaderCircle, ScanFace, Search, ShieldCheck, Trash2, TriangleAlert, UserCog, UserPlus, Users } from 'lucide-react'
import Aviso from '../components/Aviso'
import Fondo from '../components/Fondo'

// Vínculo de la persona con la institución. Es una universidad: quien
// entra puede no ser empleado de nadie. El orden es por frecuencia
// esperada, no alfabético.
const TIPOS_PERSONA = [
  ['estudiante', 'Estudiante'],
  ['docente', 'Docente'],
  ['funcionario', 'Funcionario'],
  ['contratista', 'Contratista'],
]

const ETIQUETA_TIPO = Object.fromEntries(TIPOS_PERSONA)

export default function RRHH() {
  const [logueado, setLogueado] = useState(false)
  const [usuarioActual, setUsuarioActual] = useState('')
  const [loginUser, setLoginUser] = useState('')
  const [loginPass, setLoginPass] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  // Quien entra con una contraseña temporal no pasa al sistema: primero
  // la cambia. Se guarda la temporal para poder probar el cambio.
  const [cambioPendiente, setCambioPendiente] = useState(null)

  const [identificacion, setIdentificacion] = useState('')
  const [nombre, setNombre] = useState('')
  const [regOk, setRegOk] = useState('')
  const [regErr, setRegErr] = useState('')

  // El registro va por escaneo de persona viva: datos -> escaneo -> listo.
  // La foto que queda indexada en Rekognition la produce AWS a partir del
  // video verificado, no se captura en el navegador.
  const [pasoRegistro, setPasoRegistro] = useState('datos')
  const [resultadoRegistro, setResultadoRegistro] = useState(null)
  // Los destellos del escaneo pueden desencadenar crisis en personas con
  // epilepsia fotosensible. AWS recomienda ofrecer una vía sin luces.
  const [sinDestellos, setSinDestellos] = useState(false)

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
  const [nuevoRoles, setNuevoRoles] = useState(['rrhh'])
  // La temporal la genera el servidor y viaja solo por correo al usuario.
  // Acá no se guarda la contraseña, únicamente la confirmación del envío.
  const [correoEmpleado, setCorreoEmpleado] = useState('')
  const [tipoPersona, setTipoPersona] = useState('estudiante')
  // Autorización de la persona que se va a registrar. Se guarda acá
  // entre que la da y el escaneo termina; no se persiste en el
  // navegador, la constancia que vale es la del servidor.
  const [autorizacion, setAutorizacion] = useState(null)
  const [avisoEnvio, setAvisoEnvio] = useState(null)
  // Roles en edición, por usuario. Solo entra el que se está tocando.
  const [rolesEditados, setRolesEditados] = useState({})
  const [guardandoRoles, setGuardandoRoles] = useState(null)
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

  function playSound(tipo) {
    new Audio(`/${tipo}.mp3`).play().catch(() => {})
  }

  function alerta(set, msg, ms = 4000) {
    set(msg)
    setTimeout(() => set(''), ms)
  }

  async function login() {
    setLoginLoading(true)
    setLoginError('')
    try {
      const r = await fetch(API_RESET, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'login', email: loginUser.trim(), clave: loginPass.trim() })
      })
      const data = await r.json()
      const body = typeof data.body === 'string' ? JSON.parse(data.body) : data
      // El cambio obligatorio se mira antes del rol: quien entra con una
      // temporal tiene que poder elegir su contraseña aunque todavía no
      // vaya a usar este módulo.
      if (body.codigo === 0 && body.debe_cambiar_clave) {
        setCambioPendiente({ usuario: loginUser.trim(), clave: loginPass.trim() })
      } else if (body.codigo === 0 && body.rol.includes('rrhh')) {
        setLogueado(true)
        setUsuarioActual(loginUser)
        setTimeout(() => { cargarUsuarios() }, 500)
      } else if (body.codigo === 0) {
        setLoginError('Su usuario no tiene permiso para este módulo')
      } else {
        // Una temporal vencida responde con su propio mensaje: repetir
        // "usuario o contraseña incorrectos" mandaría a buscar el error
        // donde no está.
        setLoginError(body.descripcion || 'Usuario o contraseña incorrectos')
      }
    } catch {
      setLoginError('Error de conexión')
    }
    setLoginLoading(false)
  }

  function logout() {
    setLogueado(false)
    setLoginPass('')
    setLoginUser('')
  }

  // ── Registro por escaneo de persona viva ──────────────────────
  // El escaneo lo corre el componente de Amplify contra Rekognition y el
  // backend decide. Aquí solo se recogen los datos y se muestra el veredicto.

  function iniciarEscaneo() {
    if (!identificacion.trim() || !nombre.trim()) {
      alerta(setRegErr, 'Complete la identificación y el nombre antes de escanear')
      return
    }
    if (!correoEmpleado.trim()) {
      alerta(setRegErr, 'Falta el correo de la persona: ahí le llega la constancia de su autorización')
      return
    }
    setRegErr('')
    setRegOk('')
    setResultadoRegistro(null)
    // El consentimiento va antes de la cámara. Capturar primero y
    // preguntar después sería tratar el dato sin permiso, que es
    // exactamente lo que la ley no admite.
    setPasoRegistro('consentimiento')
  }

  function autorizaDatos(constancia) {
    setAutorizacion(constancia)
    setPasoRegistro('escaneo')
  }

  function rechazaDatos() {
    setAutorizacion(null)
    setPasoRegistro('datos')
    alerta(setRegErr,
      'Sin autorización no se registra el rostro. El ingreso de esa persona se gestiona por otro medio.',
      9000)
  }

  function registroExitoso(datos) {
    playSound('success')
    setResultadoRegistro(datos)
    setPasoRegistro('listo')
    cargarUsuarios()
  }

  function registroFallido(mensaje) {
    playSound('error')
    alerta(setRegErr, mensaje, 7000)
    setPasoRegistro('datos')
  }

  function cancelarEscaneo() {
    setAutorizacion(null)
    setPasoRegistro('datos')
  }

  function nuevoRegistro() {
    setIdentificacion('')
    setNombre('')
    setCorreoEmpleado('')
    setTipoPersona('estudiante')
    setAutorizacion(null)
    setSinDestellos(false)
    setResultadoRegistro(null)
    setRegErr('')
    setRegOk('')
    setPasoRegistro('datos')
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
        alerta(setElimErr, 'No se encontró a nadie con esa identificación')
      }
    } catch {
      alerta(setElimErr, 'Error de conexión')
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
        alerta(setElimOk, body.descripcion)
        setEliminarId('')
      } else {
        playSound('error')
        alerta(setElimErr, body.descripcion || 'Error al eliminar')
      }
    } catch {
      alerta(setElimErr, 'Error de conexión')
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
    if (!nuevoUsuario.trim() || !nuevoCorreo.trim()) {
      alerta(setCrearErr, 'Complete el usuario y el correo'); return
    }
    if (!nuevoRoles.length) {
      alerta(setCrearErr, 'Seleccione al menos un rol'); return
    }
    setCrearLoading(true)
    setAvisoEnvio(null)
    try {
      const r = await fetch(API_RESET, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accion: 'crear_usuario',
          usuario: nuevoUsuario.trim(),
          correo: nuevoCorreo.trim(),
          rol: nuevoRoles.join(','),
        })
      })
      const data = await r.json()
      const body = typeof data.body === 'string' ? JSON.parse(data.body) : data
      if (body.codigo === 0) {
        playSound('success')
        setAvisoEnvio({
          usuario: nuevoUsuario.trim(),
          correo: body.correo_enmascarado,
          horas: body.horas_vigencia,
        })
        setNuevoUsuario(''); setNuevoCorreo(''); setNuevoRoles(['rrhh'])
        cargarUsuarios()
      } else {
        playSound('error')
        alerta(setCrearErr, body.descripcion || 'Error al crear usuario')
      }
    } catch {
      alerta(setCrearErr, 'Error de conexión')
    }
    setCrearLoading(false)
  }

  function alternarRolDe(usuario, rolesActuales, rol) {
    const actual = rolesEditados[usuario] || rolesActuales
    const siguiente = actual.includes(rol)
      ? actual.filter(r => r !== rol)
      : [...actual, rol]
    setRolesEditados(prev => ({ ...prev, [usuario]: siguiente }))
  }

  async function guardarRoles(usuario) {
    const roles = rolesEditados[usuario]
    if (!roles) return
    setGuardandoRoles(usuario)
    try {
      const r = await fetch(API_RESET, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accion: 'cambiar_roles',
          usuario,
          rol: roles.join(','),
          usuario_actual: usuarioActual,
        }),
      })
      const data = await r.json()
      const body = typeof data.body === 'string' ? JSON.parse(data.body) : data
      if (body.codigo === 0) {
        playSound('success')
        setRolesEditados(prev => { const n = { ...prev }; delete n[usuario]; return n })
        cargarUsuarios()
      } else {
        playSound('error')
        alerta(setCrearErr, body.descripcion || 'No se pudieron cambiar los permisos')
      }
    } catch {
      alerta(setCrearErr, 'Error de conexión')
    }
    setGuardandoRoles(null)
  }

  function alternarRol(rol) {
    setNuevoRoles(actual =>
      actual.includes(rol) ? actual.filter(r => r !== rol) : [...actual, rol])
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
    } catch { alert('Error de conexión') }
  }

  async function solicitarCodigo() {
    if (!resetEmail) { setResetErr('Ingrese su usuario'); return }
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
        setResetOk('Código enviado a su correo')
        setTimeout(() => { setResetPaso(2); setResetErr(''); setResetOk('') }, 1500)
      } else setResetErr(body.descripcion || 'Error al enviar código')
    } catch { setResetErr('Error de conexión') }
    setResetLoading(false)
  }

  async function verificarCodigo() {
    if (!resetCodigo || resetCodigo.length !== 6) { setResetErr('Ingrese el código de 6 dígitos'); return }
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
    } catch { setResetErr('Error de conexión') }
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
        setResetOk('Contraseña actualizada')
        setTimeout(() => { setResetModal(false); setResetPaso(1) }, 2000)
      } else setResetErr(body.descripcion || 'Error al cambiar contraseña')
    } catch { setResetErr('Error de conexión') }
    setResetLoading(false)
  }

  const cardStyle = { background: 'rgba(255,255,255,0.75)', borderRadius: 'var(--r-tarjeta)', padding: '24px 20px', backdropFilter: 'blur(20px)', boxShadow: 'var(--sombra-flotante)', border: '1px solid rgba(255,255,255,0.4)' }
  const inputStyle = { width: '100%', padding: '13px 16px', border: '2px solid #e8e8e8', borderRadius: 'var(--r-control)', fontFamily: 'Nunito, sans-serif', fontSize: 15, outline: 'none', background: '#fafafa' }
  const btnPrimary = { width: '100%', padding: 16, border: 'none', borderRadius: 'var(--r-control)', background: 'var(--orange)', color: 'white', fontFamily: 'Nunito, sans-serif', fontSize: 16, fontWeight: 800, cursor: 'pointer', boxShadow: 'var(--sombra-accion)' }
  const btnSecondary = { width: '100%', padding: 14, border: '2px solid var(--blue)', borderRadius: 'var(--r-control)', background: 'transparent', color: 'var(--blue)', fontFamily: 'Nunito, sans-serif', fontSize: 14, fontWeight: 700, cursor: 'pointer' }


  if (cambioPendiente) return (
    <CambioClaveObligatorio
      usuario={cambioPendiente.usuario}
      claveActual={cambioPendiente.clave}
      onListo={(roles) => {
        const usuario = cambioPendiente.usuario
        setCambioPendiente(null)
        setLoginPass('')
        if (roles.includes('rrhh')) {
          setLogueado(true)
          setUsuarioActual(usuario)
          setTimeout(() => { cargarUsuarios() }, 500)
        } else {
          alert('Contraseña actualizada. Su usuario no tiene permiso para este módulo.')
        }
      }}
      onCancelar={() => { setCambioPendiente(null); setLoginPass('') }}
    />
  )

  if (!logueado) return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <Fondo />
      <div style={{ position: 'relative', zIndex: 1, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{ padding: '40px 20px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <Link href="/" style={{ alignSelf: 'flex-start', background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', fontFamily: 'Nunito, sans-serif', fontSize: 14, fontWeight: 700, padding: '8px 16px', borderRadius: 'var(--r-pildora)', cursor: 'pointer', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}><ArrowLeft size={16} aria-hidden="true" />Volver</Link>
          <Image src="/Logocomp.png" alt="UCompensar" width={120} height={44} style={{ objectFit: 'contain', filter: 'brightness(0) invert(1)', marginTop: 8 }} />
          <div style={{ color: 'white', fontSize: 13, fontWeight: 700, letterSpacing: 1, textAlign: 'center' }}>
            PANEL RECURSOS HUMANOS<br />
            <span style={{ fontWeight: 400, fontSize: 11, opacity: 0.8 }}>Registro de Personal</span>
          </div>
        </div>
        <div>
          <div style={{ ...cardStyle, borderRadius: '24px 24px 0 0', margin: 0, marginTop: -60 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--blue)', marginBottom: 4 }}>Iniciar Sesión</div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 6 }}>Usuario</label>
              <input style={inputStyle} type="text" placeholder="Ingrese su usuario" value={loginUser} onChange={e => setLoginUser(e.target.value)} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 6 }}>Contraseña</label>
              <input style={inputStyle} type="password" placeholder="••••••••" value={loginPass} onChange={e => setLoginPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && login()} />
            </div>
            {loginError && <Aviso tipo="error" style={{ marginBottom: 10 }}>{loginError}</Aviso>}
            <button style={btnPrimary} onClick={login} disabled={loginLoading}>{loginLoading ? 'Verificando...' : 'Ingresar'}</button>
            <button onClick={() => { setResetModal(true); setResetPaso(1) }} style={{ width: '100%', marginTop: 8, background: 'none', border: 'none', color: '#4B2D8F', fontFamily: 'Nunito, sans-serif', fontSize: 13, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>
              ¿Olvidó su contraseña?
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
          <div style={{ background: 'white', borderRadius: 'var(--r-tarjeta)', padding: 28, width: '90%', maxWidth: 380 }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <ShieldCheck size={32} strokeWidth={2} aria-hidden="true" />
              <div style={{ fontSize: 18, fontWeight: 800, color: '#1A2D5A' }}>Restablecer contraseña</div>
            </div>
            {resetPaso === 1 && <>
              <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>Ingrese su usuario y le enviaremos un código al correo registrado.</p>
              <div style={{ marginBottom: 14 }}><label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 6 }}>Usuario institucional</label><input style={inputStyle} type="text" placeholder="Usuario institucional" value={resetEmail} onChange={e => setResetEmail(e.target.value)} /></div>
              {resetErr && <Aviso tipo="error" style={{ marginBottom: 10 }}>{resetErr}</Aviso>}
              {resetOk && <Aviso tipo="ok" style={{ marginBottom: 10 }}>{resetOk}</Aviso>}
              <button style={btnPrimary} onClick={solicitarCodigo} disabled={resetLoading}>{resetLoading ? 'Enviando…' : 'Enviar código'}</button>
            </>}
            {resetPaso === 2 && <>
              <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>Ingrese el código de 6 dígitos que enviamos a su correo.</p>
              <div style={{ marginBottom: 14 }}><label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 6 }}>Código</label><input style={{ ...inputStyle, letterSpacing: 8, fontSize: 20, textAlign: 'center' }} type="text" placeholder="000000" maxLength={6} value={resetCodigo} onChange={e => setResetCodigo(e.target.value)} /></div>
              {resetErr && <Aviso tipo="error" style={{ marginBottom: 10 }}>{resetErr}</Aviso>}
              <button style={btnPrimary} onClick={verificarCodigo} disabled={resetLoading}>{resetLoading ? 'Verificando…' : 'Verificar código'}</button>
            </>}
            {resetPaso === 3 && <>
              <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>Ingrese su nueva contraseña.</p>
              <div style={{ marginBottom: 14 }}><label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 6 }}>Nueva contraseña</label><input style={inputStyle} type="password" placeholder="••••••••" value={resetNueva} onChange={e => setResetNueva(e.target.value)} /></div>
              <div style={{ marginBottom: 14 }}><label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 6 }}>Confirmar</label><input style={inputStyle} type="password" placeholder="••••••••" value={resetConfirmar} onChange={e => setResetConfirmar(e.target.value)} /></div>
              {resetErr && <Aviso tipo="error" style={{ marginBottom: 10 }}>{resetErr}</Aviso>}
              {resetOk && <Aviso tipo="ok" style={{ marginBottom: 10 }}>{resetOk}</Aviso>}
              <button style={btnPrimary} onClick={cambiarClave} disabled={resetLoading}>{resetLoading ? 'Guardando…' : 'Guardar contraseña'}</button>
            </>}
            <button onClick={() => setResetModal(false)} style={{ width: '100%', marginTop: 12, background: 'none', border: '2px solid #ddd', borderRadius: 'var(--r-control)', padding: 10, fontFamily: 'Nunito, sans-serif', fontSize: 14, fontWeight: 700, color: '#888', cursor: 'pointer' }}>Cancelar</button>
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
          <Link href="/" style={{ flex: 1, padding: '10px 6px', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: 'var(--r-control)', background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)', fontFamily: 'Nunito, sans-serif', fontSize: 11, fontWeight: 700, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
            <ScanFace size={18} aria-hidden="true" /><span>Acceso</span>
          </Link>
          <button style={{ flex: 1, padding: '10px 6px', border: '1.5px solid var(--orange)', borderRadius: 'var(--r-control)', background: 'var(--orange)', color: 'white', fontFamily: 'Nunito, sans-serif', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <Users size={18} aria-hidden="true" /><span>Registro</span>
          </button>
          <Link href="/auditoria" style={{ flex: 1, padding: '10px 6px', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: 'var(--r-control)', background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)', fontFamily: 'Nunito, sans-serif', fontSize: 11, fontWeight: 700, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
            <BarChart3 size={18} aria-hidden="true" /><span>Auditoría</span>
          </Link>
        </div>

        {/* CONTENIDO */}
        <div style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* REGISTRAR */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--blue)' }}>Registrar Persona</div>
                <div style={{ fontSize: 13, color: '#666' }}>Verificación de persona viva</div>
              </div>
              <button onClick={logout} style={{ background: 'var(--blue)', border: 'none', color: 'white', fontFamily: 'Nunito, sans-serif', fontSize: 12, fontWeight: 700, padding: '8px 16px', borderRadius: 'var(--r-pildora)', cursor: 'pointer' }}>Cerrar sesión</button>
            </div>

            {/* PASO 1 — datos de la persona */}
            {pasoRegistro === 'datos' && (
              <>
                <div style={{ marginBottom: 16, padding: 12, background: '#f0f4ff', borderRadius: 'var(--r-control)', borderLeft: '4px solid var(--blue)', fontSize: 12, color: '#333', lineHeight: 1.5 }}>
                  La persona hará un escaneo en vivo: deberá centrar el rostro en el
                  óvalo{sinDestellos ? '' : ' mientras la pantalla emite destellos de color'}.
                  Una fotografía impresa o en otra pantalla no supera esta prueba.
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
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 6 }}>Vínculo con la institución</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {TIPOS_PERSONA.map(([clave, texto]) => (
                      <button
                        key={clave}
                        onClick={() => setTipoPersona(clave)}
                        style={{
                          flex: '1 1 auto', minWidth: 104, padding: '11px 10px', borderRadius: 'var(--r-control)',
                          border: tipoPersona === clave ? '2px solid var(--blue)' : '2px solid #e2e2e2',
                          background: tipoPersona === clave ? 'var(--blue)' : 'transparent',
                          color: tipoPersona === clave ? '#fff' : '#777',
                          fontFamily: 'Nunito, sans-serif', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                        }}>
                        {texto}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 6 }}>Correo de la persona</label>
                  <input style={inputStyle} type="email" placeholder="Ej: juan@correo.com" value={correoEmpleado} onChange={e => setCorreoEmpleado(e.target.value)} onKeyDown={e => e.key === 'Enter' && iniciarEscaneo()} />
                  <div style={{ fontSize: 11.5, color: '#888', marginTop: 5, lineHeight: 1.5 }}>
                    Ahí le llega la constancia de lo que autorizó y los datos para
                    revocarla. Usa un correo personal: el filtro de la universidad
                    bloquea estos mensajes.
                  </div>
                </div>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 16, padding: 12, background: '#fffaf0', borderRadius: 'var(--r-control)', border: '1px solid #f0c070', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={sinDestellos}
                    onChange={e => setSinDestellos(e.target.checked)}
                    style={{ marginTop: 2, width: 18, height: 18, flexShrink: 0, cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 12, color: '#6b4a10', lineHeight: 1.5 }}>
                    <strong>La persona es fotosensible o tiene epilepsia.</strong> Se omiten
                    los destellos de color del escaneo. Pregúntelo antes de empezar.
                  </span>
                </label>
                <button style={btnPrimary} onClick={iniciarEscaneo} disabled={!identificacion.trim() || !nombre.trim() || !correoEmpleado.trim()}>
                  Continuar
                </button>
              </>
            )}

            {/* PASO 2 — autorización de datos biométricos */}
            {pasoRegistro === 'consentimiento' && (
              <ConsentimientoDatos
                nombre={nombre.trim()}
                onAutoriza={autorizaDatos}
                onRechaza={rechazaDatos}
              />
            )}

            {/* PASO 3 — escaneo en vivo */}
            {pasoRegistro === 'escaneo' && (
              <>
                <div style={{ marginBottom: 12, padding: 12, background: '#f7f7f7', borderRadius: 'var(--r-control)', fontSize: 12, color: '#444' }}>
                  Registrando a <strong>{nombre}</strong> · CC {identificacion}
                </div>
                {/* El escaneo se dibuja sobre toda la pantalla desde un
                    portal, con su propio botón de cancelar. */}
                <LivenessScan
                  proposito="registro"
                  identificacion={identificacion.trim()}
                  nombre={nombre.trim()}
                  correo={correoEmpleado.trim()}
                  tipoPersona={tipoPersona}
                  autorizacion={autorizacion}
                  sinDestellos={sinDestellos}
                  onExito={registroExitoso}
                  onFallo={registroFallido}
                  onCancelar={cancelarEscaneo}
                />
              </>
            )}

            {/* PASO 3 — resultado */}
            {pasoRegistro === 'listo' && resultadoRegistro && (
              <>
                <div style={{ marginBottom: 14, padding: 16, background: '#e8f5e9', borderRadius: 'var(--r-control)', border: '2px solid #2e7d32' }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#2e7d32', marginBottom: 8 }}>
                    Persona registrada
                  </div>
                  <div style={{ fontSize: 13, color: '#1b5e20', marginBottom: 3 }}>
                    {resultadoRegistro.nombre} · CC {resultadoRegistro.identificacion}
                  </div>
                  <div style={{ fontSize: 12, color: '#1b5e20' }}>
                    Confianza del escaneo: <strong>{resultadoRegistro.confianza_liveness}%</strong>
                  </div>
                </div>
                <button style={btnPrimary} onClick={nuevoRegistro}>Registrar otra persona</button>
              </>
            )}

            {regOk && <Aviso tipo="ok" style={{ marginTop: 10 }}>{regOk}</Aviso>}
            {regErr && <Aviso tipo="error" style={{ marginTop: 10 }}>{regErr}</Aviso>}
          </div>

          {/* ELIMINAR */}
          <div style={{ ...cardStyle, border: '2px solid #fee2e2' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 800, color: '#c62828', marginBottom: 6 }}><Trash2 size={18} aria-hidden="true" />Eliminar Persona</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 6 }}>Número de identificación</label>
                <input style={inputStyle} type="text" placeholder="Ej: 1234567890" value={eliminarId} onChange={e => setEliminarId(e.target.value)} onKeyDown={e => e.key === 'Enter' && buscarEmpleado()} />
              </div>
              <button onClick={buscarEmpleado} style={{ padding: '13px 16px', border: 'none', borderRadius: 'var(--r-control)', background: 'var(--blue)', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center' }} aria-label="Buscar"><Search size={18} aria-hidden="true" /></button>
            </div>
            {buscarLoading && <div style={{ textAlign: 'center', color: '#888', fontSize: 13 }}>Buscando…</div>}
            {empleadoEncontrado && (
              <div style={{ marginTop: 10, padding: 16, background: '#fff3e0', borderRadius: 'var(--r-control)', border: '2px solid #FF9800' }}>
                <div style={{ fontSize: 13, color: '#888', marginBottom: 4 }}>Persona encontrada:</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--blue)' }}>{empleadoEncontrado.nombre}</div>
                <div style={{ fontSize: 13, color: '#666', marginTop: 2 }}>CC: {eliminarId}</div>
                <div style={{ marginTop: 14, padding: 10, background: '#fdecea', borderRadius: 'var(--r-control)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#c62828', fontWeight: 600 }}>
                  <TriangleAlert size={16} style={{ flexShrink: 0 }} aria-hidden="true" />
                  Esta acción eliminará a la persona y no se puede deshacer
                </div>
                <button onClick={confirmarEliminar} style={{ width: '100%', marginTop: 12, padding: 13, border: 'none', borderRadius: 'var(--r-control)', background: '#c62828', color: 'white', fontFamily: 'Nunito, sans-serif', fontSize: 15, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><Check size={17} aria-hidden="true" />Confirmar Eliminación</button>
                <button onClick={() => { setEmpleadoEncontrado(null); setEliminarId('') }} style={{ width: '100%', marginTop: 8, padding: 11, border: '2px solid #888', borderRadius: 'var(--r-control)', background: 'transparent', color: '#666', fontFamily: 'Nunito, sans-serif', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
              </div>
            )}
            {elimLoading && <div style={{ textAlign: 'center', color: '#888', fontSize: 13, marginTop: 8 }}>Eliminando…</div>}
            {elimOk && <Aviso tipo="ok" style={{ marginTop: 10 }}>{elimOk}</Aviso>}
            {elimErr && <Aviso tipo="error" style={{ marginTop: 10 }}>{elimErr}</Aviso>}
          </div>

          {/* ACTIVOS */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 800, color: '#2e7d32' }}><Users size={17} aria-hidden="true" />Personas Activas</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{activos.length > 0 ? `${activos.length} persona${activos.length !== 1 ? 's' : ''}` : '—'}</div>
              </div>
              <button onClick={toggleActivos} style={{ background: 'var(--blue)', border: 'none', color: 'white', fontFamily: 'Nunito, sans-serif', fontSize: 12, fontWeight: 700, padding: '8px 14px', borderRadius: 'var(--r-pildora)', cursor: 'pointer' }}>
                {activosLoading ? <LoaderCircle size={15} className="girando" aria-hidden="true" /> : mostrarActivos ? 'Ocultar' : 'Ver todos'}
              </button>
            </div>
            {mostrarActivos && (activos.length === 0
              ? <div style={{ textAlign: 'center', padding: '40px 20px', color: '#aaa', fontSize: 14 }}>No hay personas activas</div>
              : activos.map(e => (
                <div key={e.identificacion} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <div>
                    <div style={{ fontWeight: 800, color: 'var(--blue)', fontSize: 14 }}>{e.nombre}</div>
                    <div style={{ fontSize: 12, color: '#888' }}>
                      CC: {e.identificacion}
                      {/* Vacío en quienes se registraron antes de que
                          existiera la categoría. Se omite en vez de
                          suponerles una. */}
                      {e.tipo_persona && <> · {ETIQUETA_TIPO[e.tipo_persona] || e.tipo_persona}</>}
                    </div>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 800, color: '#c62828' }}><DoorOpen size={17} aria-hidden="true" />Personas Retiradas</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{retirados.length > 0 ? `${retirados.length} retirado${retirados.length !== 1 ? 's' : ''}` : '—'}</div>
              </div>
              <button onClick={toggleRetirados} style={{ background: '#c62828', border: 'none', color: 'white', fontFamily: 'Nunito, sans-serif', fontSize: 12, fontWeight: 700, padding: '8px 14px', borderRadius: 'var(--r-pildora)', cursor: 'pointer' }}>
                {retiradosLoading ? <LoaderCircle size={15} className="girando" aria-hidden="true" /> : mostrarRetirados ? 'Ocultar' : 'Ver todos'}
              </button>
            </div>
            {mostrarRetirados && (retirados.length === 0
              ? <div style={{ textAlign: 'center', padding: '40px 20px', color: '#aaa', fontSize: 14 }}>No hay personas retiradas</div>
              : retirados.map(e => (
                <div key={e.identificacion} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <div>
                    <div style={{ fontWeight: 800, color: '#c62828', fontSize: 14 }}>{e.nombre}</div>
                    <div style={{ fontSize: 12, color: '#888' }}>
                      CC: {e.identificacion}
                      {e.tipo_persona && <> · {ETIQUETA_TIPO[e.tipo_persona] || e.tipo_persona}</>}
                    </div>
                  </div>
                  <div style={{ width: 10, height: 10, background: '#c62828', borderRadius: '50%' }} />
                </div>
              ))
            )}
          </div>

          {/* GESTIÓN USUARIOS */}
          <div style={{ ...cardStyle, border: '2px solid #e8e0ff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 800, color: '#4B2D8F', marginBottom: 6 }}><UserCog size={18} aria-hidden="true" />Gestión de Usuarios</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#1A2D5A', marginBottom: 10 }}><UserPlus size={15} aria-hidden="true" />Crear nuevo usuario</div>
            <div style={{ marginBottom: 14 }}><label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 6 }}>Usuario institucional</label><input style={inputStyle} type="text" placeholder="Ej: jperez" value={nuevoUsuario} onChange={e => setNuevoUsuario(e.target.value)} /></div>
            <div style={{ marginBottom: 14 }}><label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 6 }}>Correo electrónico</label><input style={inputStyle} type="email" placeholder="correo@ejemplo.com" value={nuevoCorreo} onChange={e => setNuevoCorreo(e.target.value)} /></div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 6 }}>Permisos</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[['rrhh', 'Registro'], ['auditoria', 'Auditoría']].map(([valor, texto]) => (
                  <button
                    key={valor}
                    type="button"
                    onClick={() => alternarRol(valor)}
                    style={{
                      flex: 1, padding: '11px 12px', borderRadius: 'var(--r-control)', cursor: 'pointer',
                      fontFamily: 'Nunito, sans-serif', fontSize: 13, fontWeight: 700,
                      border: nuevoRoles.includes(valor) ? '2px solid var(--blue)' : '2px solid #ddd',
                      background: nuevoRoles.includes(valor) ? 'var(--blue)' : 'transparent',
                      color: nuevoRoles.includes(valor) ? 'white' : '#777',
                    }}>
                    {nuevoRoles.includes(valor) && <Check size={14} aria-hidden="true" />}{texto}
                  </button>
                ))}
              </div>
            </div>
            {crearErr && <Aviso tipo="error" style={{ marginBottom: 10 }}>{crearErr}</Aviso>}
            {crearOk && <Aviso tipo="ok" style={{ marginBottom: 10 }}>{crearOk}</Aviso>}
            <button style={btnPrimary} onClick={crearUsuario} disabled={crearLoading}>{crearLoading ? 'Creando…' : 'Crear usuario'}</button>

            {avisoEnvio && (
              <div style={{ marginTop: 14, padding: 14, background: '#f1f8f2', borderRadius: 'var(--r-control)', border: '2px solid #2e7d32', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <Check size={16} aria-hidden="true" />
                <div style={{ flex: 1, fontSize: 13, color: '#1b5e20', lineHeight: 1.5 }}>
                  Usuario <strong>{avisoEnvio.usuario}</strong> creado. Su contraseña de
                  un solo uso fue enviada al correo registrado.
                </div>
                <button
                  onClick={() => setAvisoEnvio(null)}
                  aria-label="Cerrar aviso"
                  style={{ border: 'none', background: 'transparent', color: '#2e7d32', fontSize: 16, fontWeight: 800, cursor: 'pointer', lineHeight: 1, padding: 2 }}>
                  ×
                </button>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#1A2D5A' }}><Users size={15} aria-hidden="true" />Usuarios registrados</div>
              <button onClick={cargarUsuarios} style={{ background: 'var(--blue)', border: 'none', color: 'white', fontFamily: 'Nunito, sans-serif', fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 'var(--r-pildora)', cursor: 'pointer' }}>Actualizar</button>
            </div>
            {usuariosLoading && <div style={{ textAlign: 'center', color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 13 }}><LoaderCircle size={15} className="girando" aria-hidden="true" />Cargando…</div>}
            {usuarios.map(u => {
              const roles = rolesEditados[u.usuario] || u.rol || []
              const cambiado = !!rolesEditados[u.usuario]
              const esEmergencia = u.es_emergencia === true
              return (
              <div key={u.usuario} style={{ padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, color: '#1A2D5A', fontSize: 14 }}>{u.usuario}</div>
                    <div style={{ fontSize: 12, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {u.correo || 'Sin correo registrado'}
                    </div>
                  </div>
                  {u.usuario !== usuarioActual
                    ? <button onClick={() => eliminarUsuario(u.usuario)} style={{ background: '#fdecea', border: 'none', color: '#c62828', fontFamily: 'Nunito, sans-serif', fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 'var(--r-pildora)', cursor: 'pointer', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5 }}><Trash2 size={13} aria-hidden="true" />Eliminar</button>
                    : <span style={{ fontSize: 11, color: '#888', fontStyle: 'italic', flexShrink: 0 }}>Tú</span>
                  }
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  {[['rrhh', 'Registro'], ['auditoria', 'Auditoría']].map(([clave, texto]) => {
                    const activo = roles.includes(clave)
                    return (
                      <button
                        key={clave}
                        onClick={() => !esEmergencia && alternarRolDe(u.usuario, u.rol || [], clave)}
                        disabled={esEmergencia}
                        style={{
                          border: activo ? '2px solid #1A2D5A' : '2px solid #e0e0e0',
                          background: activo ? '#1A2D5A' : 'transparent',
                          color: activo ? '#fff' : '#999',
                          fontFamily: 'Nunito, sans-serif', fontSize: 11, fontWeight: 700,
                          padding: '5px 12px', borderRadius: 'var(--r-control)',
                          // Sin opacidad rebajada: un chip encendido al 50%
                          // se lee como apagado, y entonces la fila parece
                          // decir que el usuario no tiene permisos cuando
                          // tiene los dos.
                          cursor: esEmergencia ? 'default' : 'pointer',
                        }}>
                        {activo && <Check size={14} aria-hidden="true" />}{texto}
                      </button>
                    )
                  })}

                  {cambiado && (
                    <button
                      onClick={() => guardarRoles(u.usuario)}
                      disabled={guardandoRoles === u.usuario}
                      style={{ border: 'none', background: 'var(--orange)', color: '#fff', fontFamily: 'Nunito, sans-serif', fontSize: 11, fontWeight: 800, padding: '6px 14px', borderRadius: 'var(--r-control)', cursor: 'pointer' }}>
                      {guardandoRoles === u.usuario ? <LoaderCircle size={15} className="girando" aria-hidden="true" /> : 'Guardar'}
                    </button>
                  )}
                  {cambiado && (
                    <button
                      onClick={() => setRolesEditados(prev => { const n = { ...prev }; delete n[u.usuario]; return n })}
                      style={{ border: 'none', background: 'transparent', color: '#888', fontFamily: 'Nunito, sans-serif', fontSize: 11, fontWeight: 700, padding: '6px 6px', cursor: 'pointer' }}>
                      Cancelar
                    </button>
                  )}
                  {esEmergencia && (
                    <span style={{ fontSize: 10.5, color: '#888', fontStyle: 'italic' }}>
                      siempre tiene los dos · se cambia en el servidor
                    </span>
                  )}
                </div>
              </div>
              )
            })}
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
