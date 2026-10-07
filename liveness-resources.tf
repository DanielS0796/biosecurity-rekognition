resource "aws_s3_bucket" "liveness_videos" {
  bucket = "biosecurity-liveness-videos-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name        = "Liveness Videos"
    Environment = "production"
    Purpose     = "Liveness Detection Sessions"
  }
}

resource "aws_s3_bucket_versioning" "liveness_videos_versioning" {
  bucket = aws_s3_bucket.liveness_videos.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "liveness_videos_lifecycle" {
  bucket = aws_s3_bucket.liveness_videos.id

  rule {
    id     = "delete-old-videos"
    status = "Enabled"

    filter {}

    expiration {
      days = 7
    }

    noncurrent_version_expiration {
      noncurrent_days = 7
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "liveness_videos_encryption" {
  bucket = aws_s3_bucket.liveness_videos.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.biosecurity.arn
    }
  }
}

resource "aws_dynamodb_table" "liveness_sessions" {
  table_name     = "biosecurity-liveness-sessions"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "session_id"

  attribute {
    name = "session_id"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  stream_specification {
    stream_view_type = "NEW_AND_OLD_IMAGES"
  }

  tags = {
    Name        = "Liveness Sessions"
    Environment = "production"
  }
}

data "aws_caller_identity" "current" {}
