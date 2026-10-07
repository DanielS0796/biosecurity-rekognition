resource "aws_iam_role_policy" "lambda_liveness_policy" {
  name   = "lambda-liveness-policy"
  role   = aws_iam_role.lambda_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "RekognitionLiveness"
        Effect = "Allow"
        Action = [
          "rekognition:CreateFaceLivenessSession",
          "rekognition:GetFaceLivenessSessionResults",
          "rekognition:SearchFacesByImage"
        ]
        Resource = "*"
      },
      {
        Sid    = "DynamoDBLiveness"
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          "dynamodb:Query",
          "dynamodb:UpdateItem"
        ]
        Resource = "arn:aws:dynamodb:*:*:table/biosecurity-liveness-sessions"
      },
      {
        Sid    = "S3LivenessVideos"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject"
        ]
        Resource = "${aws_s3_bucket.liveness_videos.arn}/*"
      },
      {
        Sid    = "KMSDecrypt"
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:GenerateDataKey"
        ]
        Resource = aws_kms_key.biosecurity.arn
      }
    ]
  })
}
