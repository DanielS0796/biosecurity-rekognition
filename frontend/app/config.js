// ─────────────────────────────────────────────────────────────
// Liveness Detection (AWS Rekognition Face Liveness)
// ─────────────────────────────────────────────────────────────
// El escaneo transmite video en vivo desde el navegador directo a
// Rekognition, así que el navegador necesita credenciales temporales del
// Identity Pool. Ese pool solo concede StartFaceLivenessSession.
//
// Los tres valores salen de los outputs de `terraform apply`:
//   api_liveness_init_url, api_liveness_result_url, liveness_identity_pool_id

export const AWS_REGION = "us-east-1";

export const COGNITO_IDENTITY_POOL_ID =
  process.env.NEXT_PUBLIC_IDENTITY_POOL_ID ||
  "us-east-1:149406a3-0574-4809-bde0-b75dd065d1df";

export const API_LIVENESS_INIT =
  "https://h1jhziuxw4.execute-api.us-east-1.amazonaws.com/prod/liveness-init";
export const API_LIVENESS_RESULT =
  "https://h1jhziuxw4.execute-api.us-east-1.amazonaws.com/prod/liveness-result";

// ─────────────────────────────────────────────────────────────
// APIs existentes
// ─────────────────────────────────────────────────────────────
// OBSOLETO — ninguna página lo usa desde que el acceso pasó a liveness.
// Este endpoint recibe una imagen en el cuerpo y registra el acceso sin
// comprobar que haya una persona real: una fotografía lo supera. Sigue
// activo en AWS, así que conviene deshabilitarlo (quitar el stage o el
// despliegue del API 9bm7r0q9wi) para cerrar esa vía.
export const API_VALIDAR   = "https://9bm7r0q9wi.execute-api.us-east-1.amazonaws.com/best/validar";
export const API_RRHH_URL  = "https://uadjcukyx1.execute-api.us-east-1.amazonaws.com/prod/registrar";
export const API_AUDITORIA = "https://3tqg18yo1l.execute-api.us-east-1.amazonaws.com/prod/reporte";
export const API_RESET     = "https://0geuesizya.execute-api.us-east-1.amazonaws.com/prod/reset";
export const API_KEY_RRHH  = "UBsklq8EyX8pPI2W2sHIp39gxALuSAGv7posYBGW";
export const API_KEY_AUD   = "XYyh4xXyyka10J27CVIaA4UiKpjDW37a4lepAX1n";
