from diagrams import Diagram, Cluster
from diagrams.aws.compute import Lambda
from diagrams.aws.database import Dynamodb
from diagrams.aws.network import APIGateway, CloudFront
from diagrams.aws.storage import S3
from diagrams.aws.ml import Rekognition
from diagrams.aws.security import IAMRole, KMS
from diagrams.aws.general import General
from diagrams.onprem.client import User

with Diagram("Biosecurity UCompensar", filename="arquitectura", outformat="png", show=False, direction="TB"):

    usuario = User("Usuario / Celular")

    with Cluster("Frontend"):
        cf = CloudFront("CloudFront")
        s3 = S3("S3 buckebiosecurity")
        cf >> s3

    usuario >> cf

    with Cluster("API Gateway"):
        api_val  = APIGateway("Validación\n(Público)")
        api_rrhh = APIGateway("RRHH\n(API Key)")
        api_aud  = APIGateway("Auditoría\n(API Key)")

    cf >> api_val
    cf >> api_rrhh
    cf >> api_aud

    with Cluster("Lambdas"):
        lam_val = Lambda("validacionderostros")
        lam_reg = Lambda("registrar-empleado")
        lam_aud = Lambda("biosecurity-auditoria")

    api_val  >> lam_val
    api_rrhh >> lam_reg
    api_aud  >> lam_aud

    rek = Rekognition("coleccion2anlusoft")
    lam_val >> rek
    lam_reg >> rek

    with Cluster("DynamoDB"):
        db_emp = Dynamodb("empleados")
        db_acc = Dynamodb("accesos")
        db_ret = Dynamodb("retirados")

    lam_val >> db_acc
    lam_val >> db_emp
    lam_reg >> db_emp
    lam_reg >> db_ret
    lam_aud >> db_acc

    with Cluster("Seguridad"):
        iam = IAMRole("IAM Role")
        kms = KMS("KMS Key")

    s3 >> kms
