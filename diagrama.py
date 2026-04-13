from diagrams import Diagram, Edge, Cluster
from diagrams.aws.compute import Lambda
from diagrams.aws.storage import S3
from diagrams.aws.network import APIGateway, CloudFront
from diagrams.aws.ml import Rekognition
from diagrams.aws.database import Dynamodb
from diagrams.aws.security import IAM, Cognito, KMS
from diagrams.aws.general import General

with Diagram("Biosecurity - Arquitectura Final", filename="arquitectura", show=False, direction="LR"):

    # Seguridad global
    kms = KMS("KMS\nbiosecurity-key")
    iam = IAM("IAM Role\npermisos minimos")
    cog = Cognito("Cognito\nUser Pool")

    # Frontend
    cf  = CloudFront("CloudFront\nHTTPS")
    s3  = S3("S3\nbuckebiosecurity\n🔒 KMS cifrado")

    cf >> s3
    kms >> Edge(style="dashed", color="red") >> s3

    with Cluster("1. Terminal Acceso - Publico"):
        api1 = APIGateway("API GW\n/best/validar")
        l1   = Lambda("λ validacion\nderostros")
        rek  = Rekognition("Rekognition\ncoleccion2anlusoft")
        db1  = Dynamodb("DynamoDB\nbiosecurity-accesos")
        api1 >> l1 >> rek
        l1   >> db1

    with Cluster("2. Panel RRHH - API Key"):
        api2 = APIGateway("API GW\n/prod/registrar\n🔑 API Key")
        l2   = Lambda("λ registrar\nempleado")
        db2  = Dynamodb("DynamoDB\nbiosecurity-empleados")
        api2 >> l2 >> rek
        l2   >> db2

    with Cluster("3. Panel Auditoria - API Key"):
        api3 = APIGateway("API GW\n/prod/reporte\n🔑 API Key")
        l3   = Lambda("λ auditoria\nCSV/JSON")
        api3 >> l3 >> db1

    # Cognito protege RRHH y Auditoria
    cog >> Edge(style="dashed", color="orange", label="auth") >> api2
    cog >> Edge(style="dashed", color="orange", label="auth") >> api3

    # IAM controla las lambdas
    iam >> Edge(style="dashed", color="gray") >> l1
    iam >> Edge(style="dashed", color="gray") >> l2
    iam >> Edge(style="dashed", color="gray") >> l3

    # KMS cifra DynamoDB y S3
    kms >> Edge(style="dashed", color="red") >> db1
    kms >> Edge(style="dashed", color="red") >> db2
