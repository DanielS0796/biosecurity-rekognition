'use client'
import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import LivenessScan from './components/LivenessScan'

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
      {/* FONDO */}
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
          <button style={{ flex: 1, padding: '10px 6px', border: '1.5px solid var(--orange)', borderRadius: 12, background: 'var(--orange)', color: 'white', fontFamily: 'Nunito, sans-serif', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 18 }}>🔐</span><span>Acceso</span>
          </button>
          <Link href="/rrhh" style={{ flex: 1, padding: '10px 6px', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: 12, background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)', fontFamily: 'Nunito, sans-serif', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
            <span style={{ fontSize: 18 }}>👥</span><span>Registro</span>
          </Link>
          <Link href="/auditoria" style={{ flex: 1, padding: '10px 6px', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: 12, background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)', fontFamily: 'Nunito, sans-serif', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
            <span style={{ fontSize: 18 }}>📊</span><span>Auditoría</span>
          </Link>
        </div>

        {/* PANEL ACCESO */}
        <div style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: 'rgba(255,255,255,0.75)', borderRadius: 20, padding: '24px 20px', backdropFilter: 'blur(20px)', boxShadow: '0 8px 32px rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.4)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ width: '100%', fontSize: 18, fontWeight: 800, color: 'var(--blue)', marginBottom: 4 }}>Control de Acceso</div>
            <div style={{ width: '100%', fontSize: 13, color: '#666', marginBottom: 18 }}>
              {escaneando ? 'Siga las instrucciones en pantalla' : 'Escaneo facial en vivo'}
            </div>

            {!escaneando && !resultado && (
              <>
                <div style={{ width: '100%', marginBottom: 16, padding: 14, background: '#f0f4ff', borderRadius: 14, borderLeft: '4px solid var(--blue)', fontSize: 12, color: '#333', lineHeight: 1.6 }}>
                  Centre el rostro en el óvalo y sosténgalo unos segundos. El
                  sistema comprueba que haya una persona real frente a la cámara,
                  así que una fotografía no sirve.
                </div>
                <button onClick={abrirEscaneo} style={{ width: '100%', maxWidth: 320, padding: 16, border: 'none', borderRadius: 14, background: 'var(--orange)', color: 'white', fontFamily: 'Nunito, sans-serif', fontSize: 16, fontWeight: 800, cursor: 'pointer', boxShadow: '0 4px 15px rgba(240,90,34,0.35)' }}>
                  Validar acceso
                </button>
              </>
            )}

            {escaneando && (
              <div style={{ width: '100%' }}>
                <LivenessScan
                  proposito="validacion"
                  onExito={accesoConcedido}
                  onFallo={accesoDenegado}
                  onCancelar={cancelarEscaneo}
                />
                <button onClick={cancelarEscaneo} style={{ width: '100%', marginTop: 12, padding: 12, border: '2px solid #ddd', borderRadius: 12, background: 'transparent', color: '#666', fontFamily: 'Nunito, sans-serif', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  Cancelar
                </button>
              </div>
            )}

            {resultado && (
              <div style={{ width: '100%', maxWidth: 320 }}>
                <div style={{ padding: 18, borderRadius: 14, textAlign: 'center', background: resultado.ok ? '#e8f5e9' : '#fdecea', color: resultado.ok ? '#2e7d32' : '#c62828', border: `2px solid ${resultado.ok ? '#2e7d32' : '#c62828'}` }}>
                  <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>{resultado.msg}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.85, lineHeight: 1.5 }}>{resultado.sub}</div>
                  {resultado.detalle && (
                    <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.7, marginTop: 8 }}>{resultado.detalle}</div>
                  )}
                </div>
                <button onClick={abrirEscaneo} style={{ width: '100%', marginTop: 12, padding: 14, border: 'none', borderRadius: 14, background: 'var(--orange)', color: 'white', fontFamily: 'Nunito, sans-serif', fontSize: 15, fontWeight: 800, cursor: 'pointer' }}>
                  Nuevo escaneo
                </button>
              </div>
            )}
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
