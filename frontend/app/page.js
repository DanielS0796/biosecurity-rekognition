'use client'
import { useRef, useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { API_VALIDAR } from './config'

export default function Home() {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const [status, setStatus] = useState('📷 Cámara lista')
  const [resultado, setResultado] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    iniciarCamara()
  }, [])

  async function iniciarCamara() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      if (videoRef.current) videoRef.current.srcObject = stream
    } catch {
      setStatus('❌ Sin acceso a cámara')
    }
  }

  function playSound(tipo) {
    const audio = new Audio(`/${tipo}.mp3`)
    audio.play().catch(() => {})
  }

  async function validar() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    setLoading(true)
    setResultado(null)

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    const img = canvas.toDataURL('image/jpeg', 0.8)

    try {
      const r = await fetch(API_VALIDAR, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imgvalidacion: img })
      })
      const data = await r.json()
      const body = typeof data.body === 'string' ? JSON.parse(data.body) : data

      if (body.codigo === 0) {
        playSound('success')
        const tipo = body.tipo_acceso === 'ENTRADA' ? 'Entrada registrada' : 'Salida registrada'
        const saludo = body.tipo_acceso === 'ENTRADA' ? '¡Bienvenido!' : '¡Hasta luego!'
        setResultado({ ok: true, msg: `${saludo} ${body.nombre || ''}`, sub: tipo })
      } else {
        playSound('error')
        setResultado({ ok: false, msg: 'Acceso Denegado', sub: 'Rostro no reconocido' })
      }
    } catch {
      playSound('error')
      setResultado({ ok: false, msg: 'Sin conexión', sub: 'Intente nuevamente' })
    }

    setLoading(false)
    setTimeout(() => setResultado(null), 6000)
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
            <div style={{ width: '100%', fontSize: 13, color: '#666', marginBottom: 18 }}>Posicione su rostro y valide</div>

            {/* CÁMARA */}
            <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', background: '#000', width: '100%', maxWidth: 320, aspectRatio: '3/4', maxHeight: 320 }}>
              <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <div style={{ width: 160, height: 190, border: '3px solid rgba(255,255,255,0.6)', borderRadius: '50%', boxShadow: '0 0 0 2000px rgba(0,0,0,0.35)' }} />
              </div>
              <div style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.6)', color: 'white', fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 20, whiteSpace: 'nowrap' }}>
                {status}
              </div>
            </div>
            <canvas ref={canvasRef} style={{ display: 'none' }} />

            <button onClick={validar} disabled={loading} style={{ marginTop: 14, width: '100%', maxWidth: 320, padding: 16, border: 'none', borderRadius: 14, background: 'var(--orange)', color: 'white', fontFamily: 'Nunito, sans-serif', fontSize: 16, fontWeight: 800, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1, boxShadow: '0 4px 15px rgba(240,90,34,0.35)' }}>
              {loading ? '⏳ Verificando...' : 'Validar Acceso'}
            </button>

            {resultado && (
              <div style={{ marginTop: 12, width: '100%', maxWidth: 320, padding: 16, borderRadius: 14, textAlign: 'center', fontSize: 15, fontWeight: 700, background: resultado.ok ? '#e8f5e9' : '#fdecea', color: resultado.ok ? '#2e7d32' : '#c62828', border: `2px solid ${resultado.ok ? '#2e7d32' : '#c62828'}` }}>
                {resultado.ok ? '✅' : '❌'} {resultado.msg}<br />
                <small style={{ fontWeight: 600, opacity: 0.8 }}>{resultado.sub}</small>
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
