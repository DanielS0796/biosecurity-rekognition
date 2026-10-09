'use client'
import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import LivenessScan from './components/LivenessScan'
import { BarChart3, ScanFace, Users } from 'lucide-react'
import Fondo from './components/Fondo'

export default function Home() {
  // El control de acceso va por escaneo de persona viva. Antes se capturaba
  // un frame con canvas y se enviaba a validar: ese camino aceptaba una
  // fotografía impresa o mostrada en otra pantalla. Ahora Rekognition
  // verifica el video en vivo y el backend resuelve la identidad con la
  // imagen que AWS extrae de ese video.
  const [escaneando, setEscaneando] = useState(false)
  const [resultado, setResultado] = useState(null)

  function playSound(tipo) {
    const audio = new Audio(`/${tipo}.mp3`)
    audio.play().catch(() => {})
  }

  function abrirEscaneo() {
    setResultado(null)
    setEscaneando(true)
  }

  function accesoConcedido(datos) {
    playSound('success')
    setEscaneando(false)
    setResultado({
      ok: true,
      msg: `${datos.mensaje} ${datos.nombre || ''}`.trim(),
      sub: datos.tipo_acceso === 'ENTRADA' ? 'Entrada registrada' : 'Salida registrada',
      detalle: `Rostro ${datos.similitud}% · escaneo ${datos.confianza_liveness}%`,
    })
    setTimeout(() => setResultado(null), 8000)
  }

  function accesoDenegado(mensaje) {
    playSound('error')
    setEscaneando(false)
    setResultado({ ok: false, msg: 'Acceso denegado', sub: mensaje })
  }

  function cancelarEscaneo() {
    setEscaneando(false)
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <Fondo />

      {/* CONTENIDO */}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        {/* HEADER */}
        <div style={{ padding: '20px 20px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <Image src="/Logocomp.png" alt="UCompensar" width={120} height={36} style={{ objectFit: 'contain', filter: 'brightness(0) invert(1)' }} />
          <div style={{ color: 'white', fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', opacity: 0.9 }}>
            Sistema Biosecurity
          </div>
        </div>

        {/* NAVBAR */}
        <div style={{ display: 'flex', gap: 6, padding: '14px 16px 0' }}>
          <button style={{ flex: 1, padding: '10px 6px', border: '1.5px solid var(--orange)', borderRadius: 'var(--r-control)', background: 'var(--orange)', color: 'white', fontFamily: 'Nunito, sans-serif', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <ScanFace size={18} aria-hidden="true" /><span>Acceso</span>
          </button>
          <Link href="/rrhh" style={{ flex: 1, padding: '10px 6px', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: 'var(--r-control)', background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)', fontFamily: 'Nunito, sans-serif', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
            <Users size={18} aria-hidden="true" /><span>Registro</span>
          </Link>
          <Link href="/auditoria" style={{ flex: 1, padding: '10px 6px', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: 'var(--r-control)', background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)', fontFamily: 'Nunito, sans-serif', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
            <BarChart3 size={18} aria-hidden="true" /><span>Auditoría</span>
          </Link>
        </div>

        {/* PANEL ACCESO */}
        <div style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: 'rgba(255,255,255,0.75)', borderRadius: 'var(--r-tarjeta)', padding: '24px 20px', backdropFilter: 'blur(20px)', boxShadow: 'var(--sombra-flotante)', border: '1px solid rgba(255,255,255,0.4)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ width: '100%', fontSize: 18, fontWeight: 800, color: 'var(--blue)', marginBottom: 4 }}>Control de Acceso</div>
            <div style={{ width: '100%', fontSize: 13, color: '#666', marginBottom: 18 }}>
              {escaneando ? 'Siga las instrucciones en pantalla' : 'Escaneo facial en vivo'}
            </div>

            {!escaneando && !resultado && (
              <>
                <div style={{ width: '100%', marginBottom: 16, padding: 14, background: '#f0f4ff', borderRadius: 'var(--r-control)', borderLeft: '4px solid var(--blue)', fontSize: 12, color: '#333', lineHeight: 1.6 }}>
                  Centre el rostro en el óvalo y sosténgalo unos segundos. El
                  sistema comprueba que haya una persona real frente a la cámara,
                  así que una fotografía no sirve.
                </div>
                <button onClick={abrirEscaneo} style={{ width: '100%', maxWidth: 320, padding: 16, border: 'none', borderRadius: 'var(--r-control)', background: 'var(--orange)', color: 'white', fontFamily: 'Nunito, sans-serif', fontSize: 16, fontWeight: 800, cursor: 'pointer', boxShadow: 'var(--sombra-accion)' }}>
                  Validar acceso
                </button>
              </>
            )}

            {/* El escaneo se dibuja sobre toda la pantalla desde un portal,
                con su propio botón de cancelar. */}
            {escaneando && (
              <LivenessScan
                proposito="validacion"
                onExito={accesoConcedido}
                onFallo={accesoDenegado}
                onCancelar={cancelarEscaneo}
              />
            )}

            {resultado && (
              <div style={{ width: '100%', maxWidth: 320 }}>
                <div style={{ padding: 18, borderRadius: 'var(--r-control)', textAlign: 'center', background: resultado.ok ? '#e8f5e9' : '#fdecea', color: resultado.ok ? '#2e7d32' : '#c62828', border: `2px solid ${resultado.ok ? '#2e7d32' : '#c62828'}` }}>
                  <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>{resultado.msg}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.85, lineHeight: 1.5 }}>{resultado.sub}</div>
                  {resultado.detalle && (
                    <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.7, marginTop: 8 }}>{resultado.detalle}</div>
                  )}
                </div>
                <button onClick={abrirEscaneo} style={{ width: '100%', marginTop: 12, padding: 14, border: 'none', borderRadius: 'var(--r-control)', background: 'var(--orange)', color: 'white', fontFamily: 'Nunito, sans-serif', fontSize: 15, fontWeight: 800, cursor: 'pointer' }}>
                  Nuevo escaneo
                </button>
              </div>
            )}

            {/* Deber de información de la Ley 1581: la persona tiene que
                poder ver, en el momento en que le escanean la cara, qué
                se está tratando y cómo salirse. El consentimiento se dio
                una vez al registrarse; esto no lo repite, lo recuerda. */}
            <div style={{ width: '100%', marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(0,0,0,0.08)', fontSize: 11, color: '#777', lineHeight: 1.6, textAlign: 'center' }}>
              Tus datos biométricos se tratan según la política que autorizaste al
              registrarte. Para consultarla o revocar tu autorización, escribe a
              biosecurityucompensar@gmail.com
            </div>
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
