'use client';

import { useState } from 'react';
import { Camera, CheckCircle, AlertCircle, Loader } from 'lucide-react';

export default function LivenessRegister() {
  const [step, setStep] = useState('form');
  const [formData, setFormData] = useState({ identificacion: '', nombre: '' });
  const [videoStream, setVideoStream] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [captureCount, setCaptureCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successData, setSuccessData] = useState(null);

  const handleInitiateLiveness = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/liveness-init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      if (data.session_id) {
        setSessionId(data.session_id);
        setStep('liveness');
        startVideoCapture();
      }
    } catch (err) {
      setError('Error iniciando sesión de liveness');
    }
    setLoading(false);
  };

  const startVideoCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      setVideoStream(stream);
    } catch (err) {
      setError('Acceso a cámara denegado');
    }
  };

  const capturePhotoFromVideo = () => {
    const video = document.getElementById('videoElement');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    return canvas.toDataURL('image/jpeg');
  };

  const handleCapture = () => {
    const newCount = captureCount + 1;
    setCaptureCount(newCount);
    if (newCount === 4) {
      handleSubmitWithLiveness();
    }
  };

  const handleSubmitWithLiveness = async () => {
    setLoading(true);
    try {
      const imgvalidacion = capturePhotoFromVideo();
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/validar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          liveness_session_id: sessionId,
          imgvalidacion,
          identificacion: formData.identificacion,
        }),
      });
      const data = await response.json();
      if (data.success) {
        await registrarEmpleado(data.identificacion);
      } else {
        setError(data.error || 'Validación fallida');
      }
    } catch (err) {
      setError('Error en validación');
    }
    setLoading(false);
  };

  const registrarEmpleado = async (identificacion) => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_RRHH_API_URL}/registrar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.NEXT_PUBLIC_RRHH_API_KEY,
        },
        body: JSON.stringify({
          identificacion,
          nombre: formData.nombre,
          metodo: 'liveness',
        }),
      });
      const data = await response.json();
      setSuccessData(data);
      setStep('success');
      if (videoStream) videoStream.getTracks().forEach(track => track.stop());
    } catch (err) {
      setError('Error en registro');
    }
  };

  if (step === 'form') {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold">Registro con Liveness Detection</h2>
        <input
          type="text"
          placeholder="Identificación"
          value={formData.identificacion}
          onChange={(e) => setFormData({ ...formData, identificacion: e.target.value })}
          className="w-full px-4 py-2 border rounded"
        />
        <input
          type="text"
          placeholder="Nombre"
          value={formData.nombre}
          onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
          className="w-full px-4 py-2 border rounded"
        />
        <button
          onClick={handleInitiateLiveness}
          disabled={!formData.identificacion || !formData.nombre || loading}
          className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? <Loader className="inline mr-2 animate-spin" /> : <Camera className="inline mr-2" />}
          Siguiente: Captura de Video
        </button>
        {error && <div className="text-red-600 flex items-center"><AlertCircle className="mr-2" />{error}</div>}
      </div>
    );
  }

  if (step === 'liveness') {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold">Captura de Video - Liveness Detection</h2>
        <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
          {videoStream && (
            <video
              id="videoElement"
              autoPlay
              playsInline
              className="w-full h-full"
            />
          )}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-48 h-48 border-4 border-blue-500 rounded-full opacity-50"></div>
          </div>
          <div className="absolute top-4 left-4 bg-black bg-opacity-75 text-white p-4 rounded text-sm">
            <p>✓ Mira a la cámara</p>
            <p>✓ Parpadea naturalmente</p>
            <p>✓ Gira la cabeza</p>
            <p>✓ Buena iluminación</p>
          </div>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all"
            style={{ width: `${(captureCount / 4) * 100}%` }}
          ></div>
        </div>
        <p className="text-center text-sm text-gray-600">{captureCount}/4 capturas</p>
        <button
          onClick={handleCapture}
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? <Loader className="inline mr-2 animate-spin" /> : <Camera className="inline mr-2" />}
          Capturar
        </button>
        {error && <div className="text-red-600 flex items-center"><AlertCircle className="mr-2" />{error}</div>}
      </div>
    );
  }

  if (step === 'success') {
    return (
      <div className="space-y-4 text-center">
        <CheckCircle className="w-16 h-16 text-green-600 mx-auto" />
        <h2 className="text-2xl font-bold text-green-600">¡Registro exitoso!</h2>
        <div className="bg-green-50 p-4 rounded">
          <p className="text-gray-700"><strong>Identificación:</strong> {successData?.identificacion}</p>
          <p className="text-gray-700"><strong>Nombre:</strong> {formData.nombre}</p>
          <p className="text-gray-700"><strong>Método:</strong> Liveness Detection</p>
        </div>
      </div>
    );
  }
}
