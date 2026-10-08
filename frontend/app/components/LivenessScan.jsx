'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Amplify } from 'aws-amplify'
import { FaceLivenessDetector } from '@aws-amplify/ui-react-liveness'
import '@aws-amplify/ui-react/styles.css'
import {
  AWS_REGION,
  COGNITO_IDENTITY_POOL_ID,
  API_LIVENESS_INIT,
  API_LIVENESS_RESULT,
} from '../config'

/**
 * Escaneo de persona viva con AWS Rekognition Face Liveness.
 *
 * El componente de Amplify abre la cámara y transmite video en vivo directo
 * a Rekognition, que ejecuta el desafío correspondiente. El tipo de desafío
 * lo decide el backend al crear la sesión y el componente adapta su interfaz
 * solo: con destellos de color en el registro, y solo el óvalo en la entrada
 * para que sea más rápida. Una foto impresa o en pantalla no pasa ninguno de
 * los dos.
 *
 * El resultado NO se decide en el navegador. Cuando el análisis termina,
 * este componente solo le avisa al backend con el session_id; el Lambda
 * consulta el veredicto a Rekognition y actúa con la imagen que AWS
 * extrajo del video, no con una que mande el navegador.
 *
 * El escaneo se monta en un portal sobre el body, no donde se invoca. En
 * móvil el componente de Amplify se pone `position: fixed` a pantalla
 * completa durante la verificación, y las tarjetas de la app usan
 * `backdrop-filter`, que convierte a la tarjeta en el marco de referencia de
 * los elementos fijos. Encerrado ahí, el escaneo intenta ocupar "toda la
 * pantalla" y termina ocupando el tamaño de la tarjeta, descentrado y con la
 * proporción deformada. Sobre el body no hay nada que lo contenga.
 *
 * Props:
 *   proposito      "registro" | "validacion"
 *   identificacion cédula (obligatoria para registro)
 *   nombre         nombre del empleado (obligatorio para registro)
 *   correo         a dónde se envía la constancia (obligatorio para registro)
 *   tipoPersona    estudiante | docente | funcionario | contratista
 *   autorizacion   { autorizado, politica_version, canal } (obligatoria para registro)
 *   sinDestellos   omite la secuencia de luces (vía para fotosensibles)
 *   onExito        (datos) => void   resultado del backend
 *   onFallo        (mensaje) => void
 *   onCancelar     () => void
 */

let amplifyListo = false

function configurarAmplify() {
  if (amplifyListo) return
  Amplify.configure({
    Auth: {
      Cognito: {
        identityPoolId: COGNITO_IDENTITY_POOL_ID,
        allowGuestAccess: true,
      },
    },
  })
  amplifyListo = true
}

const TEXTOS = {
  // Pantalla inicial
  // Esta advertencia la trae AWS por omisión y es deliberada: los destellos
  // pueden desencadenar crisis en personas con epilepsia fotosensible. La
  // traducción conserva el texto completo del original, incluida la mención
  // explícita a las convulsiones.
  photosensitivityWarningHeadingText: 'Advertencia de fotosensibilidad',
  photosensitivityWarningBodyText:
    'Esta verificación emite destellos de distintos colores. Proceda con precaución si usted es fotosensible.',
  photosensitivityWarningInfoText:
    'Algunas personas pueden sufrir convulsiones epilépticas al exponerse a luces de colores. Proceda con precaución si usted, o alguien de su familia, tiene una condición epiléptica.',
  photosensitivityWarningLabelText: 'Más información sobre fotosensibilidad',
  goodFitCaptionText: 'Posición correcta',
  goodFitAltText: 'Rostro centrado dentro del óvalo',
  tooFarCaptionText: 'Demasiado lejos',
  tooFarAltText: 'Rostro lejos del óvalo',
  startScreenBeginCheckText: 'Comenzar escaneo',

  // Indicaciones durante el escaneo
  hintMoveFaceFrontOfCameraText: 'Ponga el rostro frente a la cámara',
  hintTooManyFacesText: 'Debe haber solo un rostro frente a la cámara',
  hintFaceDetectedText: 'Rostro detectado',
  hintCanNotIdentifyText: 'No se detecta el rostro',
  hintTooCloseText: 'Aléjese un poco',
  hintTooFarText: 'Acérquese un poco',
  hintConnectingText: 'Conectando...',
  hintVerifyingText: 'Verificando...',
  hintCheckCompleteText: 'Escaneo completo',
  hintIlluminationTooBrightText: 'Hay demasiada luz',
  hintIlluminationTooDarkText: 'Hay poca luz',
  hintIlluminationNormalText: 'Iluminación adecuada',
  hintHoldFaceForFreshnessText: 'No se mueva',
  hintCenterFaceText: 'Centre el rostro',
  hintCenterFaceInstructionText: 'Centre el rostro dentro del óvalo',
  hintFaceOffCenterText: 'El rostro está descentrado',
  hintMatchIndicatorText: 'Ajuste del rostro',

  // Cámara
  cameraMinSpecificationsHeadingText: 'La cámara no cumple los requisitos',
  cameraMinSpecificationsMessageText:
    'Se necesita una cámara de al menos 320x240 y 15 cuadros por segundo.',
  cameraNotFoundHeadingText: 'No se encontró cámara',
  cameraNotFoundMessageText: 'Revise que la cámara esté conectada y dé permiso al navegador.',
  retryCameraPermissionsText: 'Intentar de nuevo',
  waitingCameraPermissionText: 'Esperando el permiso de la cámara...',
  a11yVideoLabelText: 'Video de la cámara',

  // Grabación
  recordingIndicatorText: 'Grabando',
  cancelLivenessCheckText: 'Cancelar escaneo',

  // Errores
  errorLabelText: 'Error',
  connectionTimeoutHeaderText: 'Se agotó el tiempo de conexión',
  connectionTimeoutMessageText: 'La conexión es lenta. Verifique su internet e intente de nuevo.',
  timeoutHeaderText: 'Se agotó el tiempo',
  timeoutMessageText: 'El rostro no estuvo dentro del óvalo el tiempo necesario. Intente de nuevo.',
  faceDistanceHeaderText: 'Movimiento detectado',
  faceDistanceMessageText: 'No se acerque ni se aleje durante el escaneo. Intente de nuevo.',
  multipleFacesHeaderText: 'Varios rostros detectados',
  multipleFacesMessageText: 'Solo una persona debe estar frente a la cámara. Intente de nuevo.',
  clientHeaderText: 'Error en el dispositivo',
  clientMessageText: 'El escaneo falló por un problema del dispositivo. Intente de nuevo.',
  serverHeaderText: 'Error del servidor',
  serverMessageText: 'No se pudo completar el escaneo. Intente de nuevo.',
  landscapeHeaderText: 'Gire el dispositivo',
  landscapeMessageText: 'El escaneo no funciona en horizontal.',
  portraitMessageText: 'Ponga el dispositivo en vertical para continuar.',
  tryAgainText: 'Intentar de nuevo',
}

export default function LivenessScan({
  proposito = 'validacion',
  identificacion = '',
  nombre = '',
  correo = '',
  tipoPersona = 'estudiante',
  // Constancia de la autorización que la persona dio antes de llegar
  // acá. El servidor la verifica y la guarda; el navegador solo la
  // transporta.
  autorizacion = null,
  sinDestellos = false,
  onExito,
  onFallo,
  onCancelar,
}) {
  const [sessionId, setSessionId] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  // El desafío sin destellos habilita elegir entre cámara frontal y trasera,
  // y en un control de acceso la trasera no tiene sentido. Se preselecciona
  // la frontal y el selector queda oculto por CSS.
  const [deviceId, setDeviceId] = useState(null)
  const [montado, setMontado] = useState(false)
  // Evita que un render extra del componente dispare dos sesiones.
  const iniciado = useRef(false)

  useEffect(() => { setMontado(true) }, [])

  // Pide un stream con la cámara frontal solo para quedarse con su
  // identificador. De paso dispara el permiso de cámara antes del escaneo.
  async function buscarCamaraFrontal() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
      })
      const id = stream.getVideoTracks()[0]?.getSettings?.().deviceId || null
      stream.getTracks().forEach(t => t.stop())
      return id
    } catch {
      return null
    }
  }

  useEffect(() => {
    if (iniciado.current) return
    iniciado.current = true

    if (!COGNITO_IDENTITY_POOL_ID || COGNITO_IDENTITY_POOL_ID.startsWith('PENDIENTE')) {
      setError(
        'Falta configurar el Identity Pool de Cognito. Revise liveness_identity_pool_id en los outputs de Terraform.'
      )
      setCargando(false)
      return
    }

    configurarAmplify()

    ;(async () => {
      try {
        setDeviceId(await buscarCamaraFrontal())

        const r = await fetch(API_LIVENESS_INIT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            proposito, identificacion, nombre, correo,
            tipo_persona: tipoPersona,
            autorizacion, sin_destellos: sinDestellos,
          }),
        })
        const data = await r.json()

        if (!r.ok || !data.session_id) {
          setError(data.descripcion || 'No se pudo iniciar el escaneo')
          setCargando(false)
          return
        }

        setSessionId(data.session_id)
      } catch (err) {
        setError('No se pudo contactar el servidor: ' + err.message)
      }
      setCargando(false)
    })()
    // Las dependencias son los campos de la autorización, no el objeto:
    // si el padre lo construye en línea, la identidad cambia en cada
    // render y el efecto se reiniciaría sin fin, abriendo una sesión de
    // Rekognition cada vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposito, identificacion, nombre, correo, tipoPersona, sinDestellos,
      autorizacion?.autorizado, autorizacion?.politica_version])

  // Rekognition terminó de analizar el video. Le pedimos el veredicto al
  // backend, que es el único que puede consultarlo.
  const alCompletar = useCallback(async () => {
    try {
      const r = await fetch(API_LIVENESS_RESULT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      })
      const data = await r.json()

      if (r.ok && data.codigo === 0) {
        onExito?.(data)
      } else {
        onFallo?.(data.descripcion || 'La verificación no fue exitosa')
      }
    } catch (err) {
      onFallo?.('No se pudo obtener el resultado: ' + err.message)
    }
  }, [sessionId, onExito, onFallo])

  const alFallar = useCallback(
    (livenessError) => {
      const estado = livenessError?.state || livenessError?.error?.name || 'desconocido'
      onFallo?.(`El escaneo falló (${estado}). Intente de nuevo.`)
    },
    [onFallo]
  )

  if (cargando) {
    return (
      <div style={estilos.caja}>
        <p style={estilos.texto}>Preparando el escaneo...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={estilos.caja}>
        <p style={{ ...estilos.texto, color: '#c0392b' }}>{error}</p>
        <button onClick={onCancelar} style={estilos.boton}>
          Cerrar
        </button>
      </div>
    )
  }

  if (!montado) return null

  const escaneo = (
    <div style={estilos.overlay}>
      <div style={estilos.marco}>
        <FaceLivenessDetector
          sessionId={sessionId}
          region={AWS_REGION}
          onAnalysisComplete={alCompletar}
          onError={alFallar}
          onUserCancel={onCancelar}
          displayText={TEXTOS}
          config={deviceId ? { deviceId } : undefined}
        />
      </div>
      <button onClick={onCancelar} style={estilos.cancelar}>
        Cancelar
      </button>
    </div>
  )

  return createPortal(escaneo, document.body)
}

const estilos = {
  // Sin backdrop-filter, transform, filter, perspective ni will-change: todos
  // crean un containing block y volverían a romper el modo pantalla completa
  // del escaneo en móvil.
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 9999,
    background: '#101828',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 16,
    overflowY: 'auto',
  },
  marco: {
    width: '100%',
    maxWidth: 640,
  },
  cancelar: {
    padding: '12px 28px',
    border: '1.5px solid rgba(255,255,255,0.35)',
    borderRadius: 10,
    background: 'transparent',
    color: '#fff',
    fontFamily: 'inherit',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    flexShrink: 0,
  },
  caja: {
    padding: '2rem',
    textAlign: 'center',
    background: '#fff',
    borderRadius: 12,
    border: '1px solid #e0e0e0',
  },
  texto: { margin: '0 0 1rem', fontSize: '0.95rem', lineHeight: 1.5 },
  boton: {
    padding: '0.6rem 1.4rem',
    border: 'none',
    borderRadius: 8,
    background: '#555',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '0.9rem',
  },
}
