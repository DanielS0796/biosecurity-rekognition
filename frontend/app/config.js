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
// Acá vivía API_VALIDAR, el endpoint del API 9bm7r0q9wi. Recibía una
// imagen en el cuerpo y registraba el acceso sin comprobar que hubiera
// una persona real: una fotografía lo superaba. Es el agujero que
// motivó pasar el acceso a liveness.
//
// Se quita del código y se cierra el stage en AWS. No se reemplaza por
// nada: el acceso ahora va por API_LIVENESS_INIT y API_LIVENESS_RESULT,
// donde la imagen que se compara es la que entrega Rekognition, no una
// que mande el navegador.
export const API_RRHH_URL  = "https://jfshekzwbl.execute-api.us-east-1.amazonaws.com/prod/registrar";
export const API_AUDITORIA = "https://sdvymkutn7.execute-api.us-east-1.amazonaws.com/prod/reporte";
export const API_RESET     = "https://qwnsrgtar9.execute-api.us-east-1.amazonaws.com/prod/reset";
export const API_KEY_RRHH  = "0LLZzFXzuPZ1KcMiKGkH6AvSDzN9Y0p3OOzEVrcc";
export const API_KEY_AUD   = "aYpCNw1m5S10zsPNhR7ao7PLLyoYTd6R6iVwTG6b";
