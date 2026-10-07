'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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
 * El componente de Amplify abre la cámara y transmite video en vivo
 * directo a Rekognition, que ejecuta los desafíos (centrar el rostro en el
 * óvalo y una secuencia de destellos de color). Una foto impresa o en
 * pantalla no pasa: no responde a los destellos ni tiene profundidad.
 *
 * El resultado NO se decide en el navegador. Cuando el análisis termina,
 * este componente solo le avisa al backend con el session_id; el Lambda
 * consulta el veredicto a Rekognition y actúa con la imagen que AWS
 * extrajo del video, no con una que mande el navegador.
 *
 * Props:
 *   proposito      "registro" | "validacion"
 *   identificacion cédula (obligatoria para registro)
 *   nombre         nombre del empleado (obligatorio para registro)
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
  photosensitivityWarningHeadingText: 'Advertencia de fotosensibilidad',
  photosensitivityWarningBodyText:
    'Esta verificación muestra luces de colores. Tenga precaución si es sensible a la luz.',
  photosensitivityWarningInfoText: 'Más información',
  photosensitivityWarningLabelText: 'Advertencia de fotosensibilidad',
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
  onExito,
  onFallo,
  onCancelar,
}) {
  const [sessionId, setSessionId] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  // Evita que un render extra del componente dispare dos sesiones.
  const iniciado = useRef(false)

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
        const r = await fetch(API_LIVENESS_INIT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ proposito, identificacion, nombre }),
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
  }, [proposito, identificacion, nombre])

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

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <FaceLivenessDetector
        sessionId={sessionId}
        region={AWS_REGION}
        onAnalysisComplete={alCompletar}
        onError={alFallar}
        onUserCancel={onCancelar}
        displayText={TEXTOS}
      />
    </div>
  )
}

const estilos = {
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
